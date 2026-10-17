import { NextResponse } from 'next/server';
import { dbGetKiosks, dbGetOrganizationBySlug } from '@/lib/db';
import { GITAM_ORG_ID } from '@/lib/store';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let orgId = searchParams.get('org_id') || searchParams.get('organization_id') || '';
    const orgSlug = searchParams.get('slug') || searchParams.get('org') || '';

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (orgSlug || (orgId && !UUID_REGEX.test(orgId))) {
      const slugToFind = orgSlug || orgId;
      const org = await dbGetOrganizationBySlug(slugToFind);
      if (org) {
        orgId = org.id;
      }
    }

    if (!orgId || !UUID_REGEX.test(orgId)) {
      orgId = GITAM_ORG_ID;
    }

    const kiosks = await dbGetKiosks(orgId);

    // Return safe public fields for kiosks display
    const publicKiosks = kiosks.map((k) => ({
      id: k.id,
      name: k.name,
      location: k.location,
      status: k.status,
      kiosk_slug: k.kiosk_slug,
      is_online: k.status === 'ONLINE' || k.status === 'READY',
    }));

    return NextResponse.json({
      success: true,
      kiosks: publicKiosks,
    });
  } catch (error) {
    console.error('[PUBLIC KIOSKS GET ERROR]:', error);
    return NextResponse.json(
      { success: false, kiosks: [] },
      { status: 200 }
    );
  }
}
