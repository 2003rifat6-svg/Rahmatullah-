/**
 * HTTP security: headers + Content-Security-Policy, exact-origin CORS, and the Origin check that
 * protects cookie-authenticated state-changing requests from other websites.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Accepts only exact origins: https://host[:port] (or http://localhost for development). No wildcards, no paths. */
export function parseCorsOrigins(raw: string | undefined): { origins: string[]; errors: string[] } {
  const errors: string[] = [];
  const origins: string[] = [];
  for (const part of (raw ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    let u: URL | null = null;
    try {
      u = new URL(part);
    } catch {
      u = null;
    }
    const isLocalHttp = u?.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (!u || (u.protocol !== 'https:' && !isLocalHttp) || u.origin !== part.replace(/\/$/, '') || part.includes('*')) {
      errors.push(`CORS_ORIGINS: "${part}" is not an exact origin like https://app.example.com (no wildcard, no path).`);
    } else if (!origins.includes(u.origin)) origins.push(u.origin);
  }
  return { origins: errors.length ? [] : origins, errors };
}

export function contentSecurityPolicy(opts: { production: boolean; extraConnect?: string[] }): string {
  // blob:/data: let the app read its OWN stored images/videos (upload, ZIP, download); they cannot reach another server.
  const connect = ["'self'", 'blob:', 'data:', 'https://accounts.google.com', 'https://storage.googleapis.com', ...(opts.extraConnect ?? [])];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Google Identity Services (sign-in) is the only external script.
    'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
    // inline styles: React style attributes; Google Fonts + Google sign-in button stylesheet
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https://storage.googleapis.com', 'https://*.googleusercontent.com'],
    'media-src': ["'self'", 'blob:', 'data:', 'https://storage.googleapis.com'],
    'connect-src': connect,
    'frame-src': ['https://accounts.google.com/gsi/'],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (opts.production) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

const isHttps = (req: Request) => req.secure || req.header('x-forwarded-proto') === 'https';

export function securityHeaders(opts: { production: boolean; corsOrigins: string[] }): RequestHandler {
  const csp = contentSecurityPolicy({ production: opts.production, extraConnect: opts.corsOrigins });
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    // allow the Google sign-in popup to talk back, but isolate everything else
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', opts.corsOrigins.length ? 'cross-origin' : 'same-origin');
    if (isHttps(req) || opts.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/** Exact-origin CORS. Only listed origins get CORS headers; everything else gets none. */
export function corsMiddleware(allowed: string[]): RequestHandler {
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.header('origin');
    if (!origin || allowed.length === 0) return req.method === 'OPTIONS' && origin ? res.sendStatus(403) : next();
    if (!allowed.includes(origin)) return req.method === 'OPTIONS' ? res.sendStatus(403) : next();
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-studio-token, x-requested-with');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

/**
 * State-changing requests must come from this site or a configured origin. Browsers always send
 * `Origin` on cross-site POST/PUT/DELETE, so another website cannot use a visitor's cookie.
 * Requests without an Origin header (scripts, curl) are not browser CSRF and are allowed here;
 * they still need the session cookie / token and the X-Requested-With header.
 */
export function originGuard(allowed: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.header('origin');
    if (!origin) return next();
    const proto = req.header('x-forwarded-proto')?.split(',')[0].trim() || req.protocol;
    const host = req.header('x-forwarded-host')?.split(',')[0].trim() || req.header('host');
    if (origin === `${proto}://${host}` || allowed.includes(origin)) return next();
    res.status(403).json({ error: 'Requests from this website origin are not allowed.', code: 'bad_origin' });
  };
}
