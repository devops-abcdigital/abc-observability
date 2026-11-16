/** Longest error message sent to Teams; the full error is in the trace. */
export const MAX_MESSAGE_LENGTH = 300;
/**
 * Only this much of a message is ever scanned or kept. Bounds the regex work on the request path
 * (messages can echo request input) and the memory held by dedupe windows.
 */
export const MAX_SCANNED_LENGTH = 2_000;

const MASK = '***';
const LONG_TOKEN_MIN_LENGTH = 32;

/** `scheme://user:pass@host` keeps the scheme and host, drops the credentials. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/?#]{1,200}@/gi;
/**
 * `name=value`, `name: value` and JSON `"name":"value"` where the name is or ends with a secret word:
 * `password`, `client_secret`, `refresh_token`, `x-api-key`, `?key=`, `&sig=`, `Pwd=`.
 */
const SECRET_ASSIGNMENT =
  /((?:[\w-]{0,40}(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|signature|credentials?)|key|sig)["']?\s{0,3}[:=]\s{0,3}["']?)[^\s"'&,;#]+/gi;
const AUTHORIZATION = /\b(Bearer|Basic)\s+[^\s,;"']+/gi;
const JWT = /\beyJ[\w-]{1,2000}\.[\w-]{1,2000}\.[\w-]{0,2000}/g;
const LONG_TOKEN = new RegExp(`[A-Za-z0-9+/_=-]{${LONG_TOKEN_MIN_LENGTH},}`, 'g');
const HEX = /^[0-9a-f]+$/i;

/**
 * Long runs that look like keys: pure hex, or mixed-case base64 with digits. Plain words, routes
 * and UUIDs (hyphens, single case) stay readable.
 */
function looksLikeKey(candidate: string): boolean {
  if (HEX.test(candidate)) return true;
  return /\d/.test(candidate) && /[a-z]/.test(candidate) && /[A-Z]/.test(candidate);
}

/** Removes credentials and key-like strings from an error message, then cuts it to {@link MAX_MESSAGE_LENGTH}. */
export function sanitizeMessage(message: string): string {
  const cleaned = message
    .slice(0, MAX_SCANNED_LENGTH)
    .replace(URL_CREDENTIALS, `$1${MASK}@`)
    .replace(SECRET_ASSIGNMENT, `$1${MASK}`)
    .replace(AUTHORIZATION, `$1 ${MASK}`)
    .replace(JWT, MASK)
    .replace(LONG_TOKEN, (candidate) => (looksLikeKey(candidate) ? MASK : candidate))
    .trim();
  return cleaned.length <= MAX_MESSAGE_LENGTH ? cleaned : `${cleaned.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}
