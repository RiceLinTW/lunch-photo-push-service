// The source API blocks requests with no User-Agent header (verified: an
// identical request with a User-Agent set returns 200, without one it
// returns 403 from Cloudflare's bot protection in front of the origin).
export const SOURCE_REQUEST_HEADERS: HeadersInit = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};
