/**
 * GITAM SMARTPRINT - TRUSTED BACKEND AUTHENTICATION & AUTHORIZATION
 *
 * Verifies Firebase ID Tokens, extracts identity claims, validates database
 * organization memberships, and enforces strict tenant isolation.
 * Never trusts client-supplied organization_ids or roles.
 */

import { store } from './store';
import { AdminRole } from './types';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  fullName: string;
  role: AdminRole;
  isSuperAdmin: boolean;
  authorizedOrganizationIds: string[];
}

export interface AuthResult {
  authenticated: boolean;
  user?: AuthenticatedUser;
  error?: string;
  status: number;
}

import { verifyFirebaseAdminIdToken } from './firebaseAdmin';

export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'admin@gitam.edu').toLowerCase();

/**
 * Validates token signature and payload.
 * Cryptographically verifies token signature via Firebase Admin SDK if service account is configured.
 * In local environment without a service account JSON, validates token structure,
 * issuer, audience, expiry, and matches against authorized admins in database.
 */
export async function verifyFirebaseIdToken(token: string): Promise<{ uid: string; email: string } | null> {
  if (!token || typeof token !== 'string') return null;

  // Check for Bearer prefix
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  if (!cleanToken) return null;

  // 1. Try Firebase Admin verification (or validated JWT payload)
  const adminResult = await verifyFirebaseAdminIdToken(cleanToken);
  if (adminResult && adminResult.email) {
    return { uid: adminResult.uid, email: adminResult.email };
  }

  // 2. Local development bootstrap token (must be set via env var, no hardcoded fallback)
  const adminSecretToken = process.env.ADMIN_SECRET_TOKEN;
  if (adminSecretToken && cleanToken === adminSecretToken) {
    return {
      uid: 'super_admin_system_local',
      email: SUPER_ADMIN_EMAIL,
    };
  }

  return null;
}

/**
 * Authenticates request from HTTP headers and resolves authorized tenant memberships.
 */
export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization') || request.headers.get('x-admin-token') || '';

  if (!authHeader) {
    return {
      authenticated: false,
      error: 'Missing Authorization header. Admin access denied.',
      status: 401,
    };
  }

  const tokenVerified = await verifyFirebaseIdToken(authHeader);
  if (!tokenVerified || !tokenVerified.email) {
    return {
      authenticated: false,
      error: 'Invalid, malformed, or expired authentication token.',
      status: 401,
    };
  }

  // Resolve user role and tenant memberships strictly from server database store
  const memberRecord = store.getMemberByEmail(tokenVerified.email);
  const isPlatformSuperAdmin =
    tokenVerified.email.toLowerCase() === SUPER_ADMIN_EMAIL ||
    memberRecord?.role === 'SUPER_ADMIN';

  const authorizedOrgs = isPlatformSuperAdmin
    ? store.getOrganizations().map((o) => o.id)
    : store.getOrganizationsForMember(tokenVerified.email);

  if (!isPlatformSuperAdmin && authorizedOrgs.length === 0) {
    return {
      authenticated: false,
      error: 'User has no authorized organization memberships.',
      status: 403,
    };
  }

  const role: AdminRole = isPlatformSuperAdmin
    ? 'SUPER_ADMIN'
    : memberRecord?.role || 'ORG_ADMIN';

  return {
    authenticated: true,
    status: 200,
    user: {
      uid: tokenVerified.uid,
      email: tokenVerified.email,
      fullName: memberRecord?.full_name || (isPlatformSuperAdmin ? 'Platform Super Admin' : 'Admin'),
      role,
      isSuperAdmin: isPlatformSuperAdmin,
      authorizedOrganizationIds: authorizedOrgs,
    },
  };
}

/**
 * Enforces Platform Super Admin role strictly.
 */
export async function requireSuperAdmin(request: Request): Promise<AuthResult> {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) return auth;

  if (!auth.user.isSuperAdmin && auth.user.role !== 'SUPER_ADMIN') {
    return {
      authenticated: false,
      error: 'Access denied: Platform Super Admin role required.',
      status: 403,
    };
  }

  return auth;
}

/**
 * Enforces Tenant Isolation: Verifies that caller has access to the target organization.
 */
export async function requireOrgAccess(request: Request, targetOrgId: string): Promise<AuthResult> {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) return auth;

  if (auth.user.isSuperAdmin) {
    return auth; // Super Admin has global cross-org oversight
  }

  if (!auth.user.authorizedOrganizationIds.includes(targetOrgId)) {
    store.logAudit(
      auth.user.email,
      'CROSS_TENANT_ACCESS_BLOCKED',
      'organization',
      targetOrgId,
      { attempted_org_id: targetOrgId, caller_orgs: auth.user.authorizedOrganizationIds }
    );
    return {
      authenticated: false,
      error: 'Access denied: You are not authorized to view or manage this organization.',
      status: 403,
    };
  }

  return auth;
}
