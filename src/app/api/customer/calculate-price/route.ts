import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { dbGetPricing, dbGetPrintJob, dbUpdatePrintJobConfig } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const {
      job_id,
      organization_id,
      pages,
      pages_selected,
      copies,
      is_color,
      is_duplex,
      orientation,
    } = await request.json();

    let targetOrgId = organization_id || GITAM_ORG_ID;

    // 1. Resolve job from memory or persistent DB
    let job = job_id ? store.getJob(job_id) : undefined;
    let dbJob = null;
    if (job_id && !job) {
      dbJob = await dbGetPrintJob(job_id);
      if (dbJob) {
        job = store.createJob({
          id: dbJob.id,
          organization_id: dbJob.organization_id || targetOrgId,
          session_id: dbJob.session_id || 'recovered_session',
          kiosk_id: dbJob.kiosk_id || 'GITAM-SPK-001',
          pages_total: dbJob.pages_total || (Number(pages) > 0 ? Number(pages) : 1),
          pages_selected: pages_selected || dbJob.pages_selected || 'All',
          copies: Math.max(1, Number(copies) || dbJob.copies || 1),
          is_color: is_color !== undefined ? Boolean(is_color) : dbJob.is_color,
          is_duplex: is_duplex !== undefined ? Boolean(is_duplex) : dbJob.is_duplex,
          orientation: (orientation as any) || (dbJob.orientation as any) || 'portrait',
          calculated_amount: dbJob.calculated_amount,
          amount_paise: dbJob.amount_paise,
          status: dbJob.status as any,
        });
      }
    }

    if (job?.organization_id) {
      targetOrgId = job.organization_id;
    } else if (dbJob?.organization_id) {
      targetOrgId = dbJob.organization_id;
    }

    const dbPricing = await dbGetPricing(targetOrgId);
    const pricing = dbPricing || store.getPricing(targetOrgId);
    const copiesNum = Math.max(1, Math.min(Number(copies) || 1, pricing.max_copies || 100));

    // Authoritative total page count: job -> dbJob -> body.pages -> fallback 1
    const pagesTotal = job?.pages_total || dbJob?.pages_total || (Number(pages) > 0 ? Number(pages) : 1);

    // Calculate effective pages
    let effectivePages = pagesTotal;
    if (pages_selected && String(pages_selected).trim().toLowerCase() !== 'all') {
      const ranges = String(pages_selected).split(',');
      let count = 0;
      for (const r of ranges) {
        const parts = r.trim().split('-');
        if (parts.length === 2) {
          const start = parseInt(parts[0], 10);
          const end = parseInt(parts[1], 10);
          if (!isNaN(start) && !isNaN(end) && end >= start) {
            count += end - start + 1;
          }
        } else if (parts.length === 1 && !isNaN(parseInt(parts[0], 10))) {
          count += 1;
        }
      }
      if (count > 0) {
        effectivePages = Math.min(count, pagesTotal);
      }
    }

    // Rate calculation in integer paise
    const ratePaise = is_color
      ? (pricing.color_price_paise || Math.round((pricing.color_price_per_page ?? 8.0) * 100))
      : (pricing.bw_price_paise || Math.round((pricing.bw_price_per_page ?? 2.5) * 100));
    const servicePaise = Math.round((pricing.service_charge ?? 0) * 100);
    const minOrderPaise = Math.round((pricing.min_order_amount ?? 1.0) * 100);

    const basePaise = effectivePages * copiesNum * ratePaise;
    const totalPaise = Math.max(minOrderPaise, basePaise + servicePaise);
    const finalAmountRupees = totalPaise / 100;

    // If job exists in store, update its runtime state
    if (job) {
      job.pages_selected = pages_selected || 'All';
      job.copies = copiesNum;
      job.is_color = Boolean(is_color);
      job.is_duplex = Boolean(is_duplex);
      job.orientation = orientation === 'landscape' ? 'landscape' : 'portrait';
      job.calculated_amount = finalAmountRupees;
      job.amount_paise = totalPaise;
      job.pricing_snapshot = {
        organization_id: targetOrgId,
        rate_paise: ratePaise,
        copies: copiesNum,
        effective_pages: effectivePages,
        service_charge_paise: servicePaise,
        calculated_at: new Date().toISOString(),
      };
    } else if (job_id) {
      // Re-register in store
      job = store.createJob({
        id: job_id,
        organization_id: targetOrgId,
        session_id: 'recovered_session',
        kiosk_id: 'GITAM-SPK-001',
        pages_total: pagesTotal,
        pages_selected: pages_selected || 'All',
        copies: copiesNum,
        is_color: Boolean(is_color),
        is_duplex: Boolean(is_duplex),
        orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
        calculated_amount: finalAmountRupees,
        amount_paise: totalPaise,
        status: 'UPLOAD_COMPLETE',
      });
    }

    // Persist updated configuration and amount to Supabase DB
    if (job_id) {
      await dbUpdatePrintJobConfig(job_id, {
        pages_total: pagesTotal,
        pages_selected: pages_selected || 'All',
        copies: copiesNum,
        is_color: Boolean(is_color),
        is_duplex: Boolean(is_duplex),
        orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
        calculated_amount: finalAmountRupees,
        amount_paise: totalPaise,
      });
    }

    return NextResponse.json({
      success: true,
      amount: finalAmountRupees,
      amount_paise: totalPaise,
      total_amount: finalAmountRupees,
      breakdown: {
        organization_id: targetOrgId,
        pages_total: pagesTotal,
        effective_pages: effectivePages,
        copies: copiesNum,
        rate_per_page: ratePaise / 100,
        rate_paise: ratePaise,
        service_charge: pricing.service_charge ?? 0,
        is_color: Boolean(is_color),
      },
    });
  } catch (error) {
    console.error('[CALCULATE PRICE ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
