/**
 * GITAM SMARTPRINT — Edge Proxy (Next.js 16)
 *
 * Protects admin and superadmin routes at the CDN/edge layer.
 * This runs BEFORE any page rendering or API route handler.
 *
 * NOTE: This is NOT a replacement for server-side auth verification —
 * every API route still independently verifies Firebase ID tokens.
 * This proxy adds defense-in-depth by:
 * 1. Redirecting unauthenticated users to the login page
 * 2. Preventing admin page HTML from being served to crawlers/bots
 * 3. Checking for the presence of an auth cookie/header
 *
 * The proxy cannot do full Firebase Admin SDK verification (Edge Runtime
 * doesn't support the full Node.js crypto used by firebase-admin).
 * API routes handle cryptographic verification.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require authentication
const ADMIN_ROUTES = ['/admin/dashboard', '/admin/printers', '/admin/settings'];
const SUPERADMIN_ROUTES = ['/superadmin/dashboard'];
const ADMIN_API_ROUTES = ['/api/admin/'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets, images, favicon, etc.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/api/webhooks') || // webhooks authenticate via signature
    pathname.startsWith('/api/customer') || // customer APIs use session tokens
    pathname.startsWith('/api/kiosk') ||     // kiosk APIs use device tokens
    pathname.startsWith('/api/cron') ||      // cron uses internal auth
    pathname.includes('.') // static files
  ) {
    return NextResponse.next();
  }

  // Check if this is a protected admin page route
  const isAdminPage =
    ADMIN_ROUTES.some((r) => pathname.startsWith(r)) ||
    (pathname === '/admin' && !pathname.startsWith('/admin/login'));
  const isSuperAdminPage = SUPERADMIN_ROUTES.some((r) => pathname.startsWith(r));

  if (isAdminPage || isSuperAdminPage) {
    // Check for auth cookie or token in the request
    // The client stores a flag cookie after successful login
    const authCookie = request.cookies.get('smartprint_auth');
    const hasAuth = Boolean(authCookie?.value);

    if (!hasAuth) {
      // Redirect to the appropriate login page
      const loginPath = isSuperAdminPage ? '/superadmin/login' : '/admin/login';
      const url = request.nextUrl.clone();
      url.pathname = loginPath;
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }
  }

  // For admin API routes, check for Authorization header presence
  // Full verification still happens in the route handler
  const isAdminApi = ADMIN_API_ROUTES.some((r) => pathname.startsWith(r));
  if (isAdminApi) {
    const authHeader =
      request.headers.get('authorization') ||
      request.headers.get('x-admin-token');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header.' },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match admin pages and APIs, but NOT static assets
    '/admin/:path*',
    '/superadmin/:path*',
    '/api/admin/:path*',
  ],
};
