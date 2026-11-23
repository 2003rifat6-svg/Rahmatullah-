/** Never let API keys or tokens reach logs or API responses. */
const PATTERNS: Array<[RegExp, string]> = [
  [/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_API_KEY]'],
  [/ya29\.[0-9A-Za-z_-]{20,}/g, '[REDACTED_TOKEN]'],
  [/eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/g, '[REDACTED_JWT]'],
  [/(bearer\s+)[0-9A-Za-z._~+/=-]{12,}/gi, '$1[REDACTED]'],
  [/((?:x-goog-api-key|api[_-]?key|access[_-]?token|authorization|client[_-]?secret|session[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',;&]{6,}/gi, '$1[REDACTED]'],
  [/([?&](?:key|api_key|access_token|X-Goog-Signature|X-Goog-Credential)=)[^&\s]+/gi, '$1[REDACTED]'],
  [/(mms_session=)[^;\s]+/g, '$1[REDACTED]'],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Message-only, redacted, length-limited text for logs and client responses. */
export function safeErrorMessage(err: unknown, max = 400): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
  return redactSecrets(raw).slice(0, max);
}

export function logError(context: string, err: unknown) {
  console.error(`${context}: ${safeErrorMessage(err)}`);
}
