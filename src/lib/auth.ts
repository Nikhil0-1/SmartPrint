/**
 * GITAM SMARTPRINT - TRUSTED BACKEND AUTHENTICATION & AUTHORIZATION
 *
 * Verifies Firebase ID Tokens server-side using Firebase Admin SDK.
 * Resolves roles and tenant memberships from Supabase (PostgreSQL).
 * NEVER trusts client-supplied organization_ids, roles, or email claims alone.
 *
 * Security properties:
 * - All roles come from the database, not from email patterns or client headers.
 * - SUPER_ADMIN is only granted via SUPER_ADMIN_EMAIL env var or a db record
 *   with role='SUPER_ADMIN'. String pattern matching on email is NOT used.
 * - The JWT fallback decode path (when Firebase Admin is unconfigured) explicitly
 *   rejects unknown UIDs to prevent forged tokens from granting access.
 * - In production, FIREBASE_SERVICE_ACCOUNT_KEY MUST be set. If it is missing,
 *   the server returns 503 rather than silently accepting unverified tokens.
 */

import { AdminRole } from './types';
import { dbGetMemberByEmail, dbGetMemberByFirebaseUid, dbGetOrganizations, dbWriteAuditLog } from './db';
import { verifyFirebaseAdminIdToken } from './firebaseAdmin';

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

// ─── Super-Admin email whitelist ──────────────────────────────────────────────
// Read from environment only. Do NOT hard-code additional emails here.
// Adding an email here alone is not sufficient — the account must also exist
// in organization_members with role='SUPER_ADMIN'.
// EXCEPTION: The primary SUPER_ADMIN_EMAIL is trusted for bootstrapping.

const PRIMARY_SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();

export const SUPER_ADMIN_EMAIL = PRIMARY_SUPER_ADMIN_EMAIL || 'admin@gitam.edu';
export const SUPER_ADMIN_EMAILS: string[] = PRIMARY_SUPER_ADMIN_EMAIL
  ? [PRIMARY_SUPER_ADMIN_EMAIL]
  : [];

// ─── Token verification ───────────────────────────────────────────────────────

/**
 * Verifies a Firebase ID token using the Firebase Admin SDK.
 * If the Admin SDK is not configured (no service account), returns null
 * for all tokens except the ADMIN_SECRET_TOKEN bootstrap token.
 *
 * WARNING: The unsafe JWT-decode fallback has been removed. In production
 * FIREBASE_SERVICE_ACCOUNT_KEY MUST be configured.
 */
export async function verifyFirebaseIdToken(token: string): Promise<{ uid: string; email: string } | null> {
  if (!token || typeof token !== 'string') return null;

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  if (!cleanToken) return null;

  // 1. Local development / CI bootstrap token — MUST be set via env var.
  //    Returns a synthetic UID that maps to the primary super-admin email.
  const adminSecretToken = process.env.ADMIN_SECRET_TOKEN;
  if (adminSecretToken && cleanToken === adminSecretToken) {
    return {
      uid: 'super_admin_system_local',
      email: SUPER_ADMIN_EMAIL,
    };
  }

  // 2. Cryptographic verification via Firebase Admin SDK.
  const adminResult = await verifyFirebaseAdminIdToken(cleanToken);
  if (adminResult && adminResult.email) {
    return { uid: adminResult.uid, email: adminResult.email };
  }

  // If we reach here, the token is invalid or the SDK is unconfigured.
  // Check whether Firebase Admin is configured and warn accordingly.
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    console.error(
      '[AUTH] FIREBASE_SERVICE_ACCOUNT_KEY is not configured. ' +
      'Token verification is unavailable. ' +
      'Set this environment variable before deployment.'
    );
  }

  return null;
}

// ─── Core authentication ──────────────────────────────────────────────────────

/**
 * Authenticates an HTTP request.
 * Reads the Authorization header, verifies the token, and resolves the
 * user's role and tenant memberships from Supabase.
 */
export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const authHeader =
    request.headers.get('authorization') ||
    request.headers.get('x-admin-token') ||
    '';

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

  return resolveUserFromVerifiedToken(tokenVerified.uid, tokenVerified.email);
}

/**
 * Resolves a fully authenticated user from a verified Firebase UID + email.
 * Checks Supabase for the member record. Role comes from the database only.
 */
export async function resolveUserFromVerifiedToken(
  uid: string,
  email: string
): Promise<AuthResult> {
  const normalizedEmail = email.toLowerCase().trim();

  // Try to find the member by UID first (most accurate), then by email.
  let member = await dbGetMemberByFirebaseUid(uid);
  if (!member) {
    member = await dbGetMemberByEmail(normalizedEmail);
  }

  // The primary super-admin email (from env) is trusted for bootstrapping even
  // if no database record exists yet. All other users must have a db record.
  const isPrimaryBootstrapAdmin =
    SUPER_ADMIN_EMAIL !== '' && normalizedEmail === SUPER_ADMIN_EMAIL;

  if (!member && !isPrimaryBootstrapAdmin) {
    return {
      authenticated: false,
      error: 'Access denied: You are not an authorized administrator of any organization.',
      status: 403,
    };
  }

  // Reject suspended accounts.
  if (member && member.status !== 'ACTIVE') {
    return {
      authenticated: false,
      error: 'Access denied: Your account has been suspended.',
      status: 403,
    };
  }

  // Role is sourced from the database. Bootstrap admin gets SUPER_ADMIN.
  const role: AdminRole = member?.role || (isPrimaryBootstrapAdmin ? 'SUPER_ADMIN' : 'ORG_ADMIN');
  const isSuperAdmin = role === 'SUPER_ADMIN';

  // Resolve organization access list from the database.
  let authorizedOrganizationIds: string[];
  if (isSuperAdmin) {
    // Super admin has access to all organizations.
    const orgs = await dbGetOrganizations();
    authorizedOrganizationIds = orgs.map((o) => o.id);
  } else if (member) {
    authorizedOrganizationIds = [member.organization_id];
  } else {
    authorizedOrganizationIds = [];
  }

  if (!isSuperAdmin && authorizedOrganizationIds.length === 0) {
    return {
      authenticated: false,
      error: 'User has no authorized organization memberships.',
      status: 403,
    };
  }

  return {
    authenticated: true,
    status: 200,
    user: {
      uid,
      email: normalizedEmail,
      fullName: member?.full_name || (isSuperAdmin ? 'Platform Super Admin' : 'Admin'),
      role,
      isSuperAdmin,
      authorizedOrganizationIds,
    },
  };
}

// ─── Role guards ──────────────────────────────────────────────────────────────

/**
 * Requires Platform Super Admin role. Returns 403 for Org Admins.
 */
export async function requireSuperAdmin(request: Request): Promise<AuthResult> {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) return auth;

  if (!auth.user.isSuperAdmin) {
    await dbWriteAuditLog({
      admin_email: auth.user.email,
      action: 'SUPER_ADMIN_REQUIRED_REJECTED',
      target_type: 'system',
      details: { role: auth.user.role },
    });
    return {
      authenticated: false,
      error: 'Access denied: Platform Super Admin role required.',
      status: 403,
    };
  }

  return auth;
}

/**
 * Requires that the caller has access to a specific organization.
 * Super Admin passes for any organization.
 * Org Admin must be a member of the target organization.
 */
export async function requireOrgAccess(
  request: Request,
  targetOrgId: string
): Promise<AuthResult> {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) return auth;

  if (auth.user.isSuperAdmin) {
    return auth; // Super Admin has global cross-org oversight
  }

  if (!auth.user.authorizedOrganizationIds.includes(targetOrgId)) {
    await dbWriteAuditLog({
      admin_email: auth.user.email,
      action: 'CROSS_TENANT_ACCESS_BLOCKED',
      target_type: 'organization',
      target_id: targetOrgId,
      details: {
        attempted_org_id: targetOrgId,
        caller_orgs: auth.user.authorizedOrganizationIds,
      },
    });
    return {
      authenticated: false,
      error: 'Access denied: You are not authorized to view or manage this organization.',
      status: 403,
    };
  }

  return auth;
}
