/**
 * Authentication: "Sign in with Google" ID token -> verified on the server ->
 * HttpOnly signed session cookie. The uid used for ALL data paths is the Google
 * account's stable `sub`, taken only from the verified token.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

export interface SessionUser {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
}

export type IdTokenVerifier = (credential: string) => Promise<SessionUser>;

export const SESSION_COOKIE = 'mms_session';
const SESSION_DAYS = 7;

export function googleIdTokenVerifier(clientId: string): IdTokenVerifier {
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('Google token has no account id / email.');
    if (p.email_verified === false) throw new Error('Google email is not verified.');
    return { uid: p.sub, email: p.email.toLowerCase(), name: p.name, picture: p.picture };
  };
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signSession(user: SessionUser, secret: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ ...user, exp: now + SESSION_DAYS * 86400_000 }));
  const sig = b64(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): SessionUser | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < now || !data.uid) return null;
    return { uid: String(data.uid), email: String(data.email || ''), name: data.name, picture: data.picture };
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(value: string, opts: { secure: boolean; crossSite: boolean; clear?: boolean }) {
  const attrs = [
    `${SESSION_COOKIE}=${opts.clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${opts.clear ? 0 : SESSION_DAYS * 86400}`,
    opts.crossSite ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (opts.secure || opts.crossSite) attrs.push('Secure');
  return attrs.join('; ');
}

/**
 * CSRF guard for cookie-authenticated, state-changing requests: browsers cannot send this
 * custom header cross-site without a CORS preflight, which this server does not allow
 * (unless CORS_ORIGIN is explicitly configured).
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.header('x-requested-with') === 'mms') return next();
  res.status(403).json({ error: 'Missing X-Requested-With header (CSRF protection).' });
}
