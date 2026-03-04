// Vercel Routing Middleware — HTTP Basic Auth for admin preview deployments.
// Runs at the edge BEFORE page assets are served.
// Active only when ADMIN_AUTH_USER and ADMIN_AUTH_PASSWORD env vars are set.
// On production (main branch) these vars are absent → middleware is a no-op.

import { next } from '@vercel/functions';

// Server-side env vars (no VITE_ prefix) — never exposed to the browser bundle.
const ADMIN_USER = process.env.ADMIN_AUTH_USER;
const ADMIN_PASS = process.env.ADMIN_AUTH_PASSWORD;

export default function middleware(request: Request): Response {
  // No auth vars configured = production deployment, skip auth entirely.
  if (!ADMIN_USER || !ADMIN_PASS) {
    return next();
  }

  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded);
      const colonIdx = decoded.indexOf(':');     // split on FIRST colon only
      const user = decoded.slice(0, colonIdx);   // allows colons in password
      const password = decoded.slice(colonIdx + 1);
      if (user === ADMIN_USER && password === ADMIN_PASS) {
        return next();
      }
    }
  }

  // No valid credentials — prompt the browser's native Basic Auth dialog.
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="WORBZ Admin"',
    },
  });
}

// Only run on document/navigation requests, skip static assets for performance.
export const config = {
  matcher: [
    '/((?!assets|vite\\.svg|orbs|weapons|.*\\.(?:js|css|png|jpg|svg|ico|woff2?|ttf|map)$).*)',
  ],
};
