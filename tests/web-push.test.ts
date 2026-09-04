import assert from "node:assert/strict";
import test from "node:test";
import { base64UrlDecode, base64UrlEncode, createVapidJwt, encryptPushPayload } from "../src/web-push.ts";

const encoder = new TextEncoder();

function join(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

async function hkdf(input: Uint8Array, salt: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(input).buffer, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

test("aes128gcm payload can be decrypted by an independent receiver", async () => {
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = JSON.stringify({ title: "Lunch", body: "Ready", url: "https://example.test/" });
  const body = await encryptPushPayload(message, { p256dh: base64UrlEncode(receiverPublic), auth: base64UrlEncode(auth) });

  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), 4096);
  const keyLength = body[20];
  const senderPublicBytes = body.slice(21, 21 + keyLength);
  const ciphertext = body.slice(21 + keyLength);
  const senderPublic = await crypto.subtle.importKey("raw", senderPublicBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: senderPublic }, receiver.privateKey, 256));
  const ikm = await hkdf(secret, auth, join(encoder.encode("WebPush: info\0"), receiverPublic, senderPublicBytes), 32);
  const cek = await hkdf(ikm, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext));
  assert.equal(plaintext.at(-1), 2);
  assert.equal(new TextDecoder().decode(plaintext.slice(0, -1)), message);
});

test("VAPID JWT has correct audiences and a valid ES256 signature", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const config = { publicKey: base64UrlEncode(publicBytes), privateKey: privateJwk.d!, subject: "mailto:test@example.com" };
  const endpoints = [
    "https://fcm.googleapis.com/fcm/send/test",
    "https://updates.push.services.mozilla.com/wpush/v2/test",
    "https://web.push.apple.com/Q-test",
  ];
  for (const endpoint of endpoints) {
    const jwt = await createVapidJwt(endpoint, config, new Date("2026-09-04T00:00:00Z"));
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(header))), { typ: "JWT", alg: "ES256" });
    assert.equal(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims))).aud, new URL(endpoint).origin);
    assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, base64UrlDecode(signature), encoder.encode(`${header}.${claims}`)), true);
  }
});
