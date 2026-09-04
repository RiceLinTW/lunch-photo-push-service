export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidConfig {
  privateKey: string;
  publicKey: string;
  subject: string;
}

const encoder = new TextEncoder();

export function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function concat(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(values.reduce((size, value) => size + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

async function hkdf(
  cryptoImpl: Crypto,
  input: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const inputBuffer = new Uint8Array(input).buffer;
  const saltBuffer = new Uint8Array(salt).buffer;
  const infoBuffer = new Uint8Array(info).buffer;
  const key = await cryptoImpl.subtle.importKey("raw", inputBuffer, "HKDF", false, ["deriveBits"]);
  const bits = await cryptoImpl.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltBuffer, info: infoBuffer }, key, length * 8);
  return new Uint8Array(bits);
}

export async function encryptPushPayload(
  payload: string,
  target: Pick<PushTarget, "p256dh" | "auth">,
  cryptoImpl: Crypto = crypto,
): Promise<Uint8Array<ArrayBuffer>> {
  const receiverPublicBytes = base64UrlDecode(target.p256dh);
  const authSecret = base64UrlDecode(target.auth);
  if (receiverPublicBytes.length !== 65 || receiverPublicBytes[0] !== 4) throw new Error("Invalid subscription p256dh key");
  if (authSecret.length !== 16) throw new Error("Invalid subscription auth secret");

  const receiverPublic = await cryptoImpl.subtle.importKey(
    "raw",
    receiverPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const senderKeys = await cryptoImpl.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const senderPublicBytes = new Uint8Array(await cryptoImpl.subtle.exportKey("raw", senderKeys.publicKey));
  const sharedSecret = new Uint8Array(await cryptoImpl.subtle.deriveBits(
    { name: "ECDH", public: receiverPublic },
    senderKeys.privateKey,
    256,
  ));

  const keyInfo = concat(encoder.encode("WebPush: info\0"), receiverPublicBytes, senderPublicBytes);
  const inputKeyMaterial = await hkdf(cryptoImpl, sharedSecret, authSecret, keyInfo, 32);
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const contentEncryptionKey = await hkdf(
    cryptoImpl,
    inputKeyMaterial,
    salt,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    cryptoImpl,
    inputKeyMaterial,
    salt,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );
  const plaintext = concat(encoder.encode(payload), new Uint8Array([2]));
  const aesKey = await cryptoImpl.subtle.importKey("raw", contentEncryptionKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([senderPublicBytes.length]), senderPublicBytes, ciphertext);
}

export async function createVapidJwt(
  endpoint: string,
  config: VapidConfig,
  now = new Date(),
  cryptoImpl: Crypto = crypto,
): Promise<string> {
  const publicBytes = base64UrlDecode(config.publicKey);
  const privateBytes = base64UrlDecode(config.privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) throw new Error("Invalid VAPID key pair");
  const origin = new URL(endpoint).origin;
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({
    aud: origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: config.subject,
  })));
  const unsigned = `${header}.${claims}`;
  const privateKey = await cryptoImpl.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicBytes.slice(1, 33)),
    y: base64UrlEncode(publicBytes.slice(33, 65)),
    d: base64UrlEncode(privateBytes),
    ext: true,
    key_ops: ["sign"],
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await cryptoImpl.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoder.encode(unsigned));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  config: VapidConfig,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const body = await encryptPushPayload(JSON.stringify(payload), target);
  const jwt = await createVapidJwt(target.endpoint, config);
  return fetcher(target.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${config.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
    },
    body,
  });
}
