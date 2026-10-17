import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { dbGetPricing } from '@/lib/db';

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
    let job = job_id ? store.getJob(job_id) : undefined;
    if (job?.organization_id) {
      targetOrgId = job.organization_id;
    }

    const dbPricing = await dbGetPricing(targetOrgId);
    const pricing = dbPricing || store.getPricing(targetOrgId);
    const copiesNum = Math.max(1, Math.min(Number(copies) || 1, pricing.max_copies));

    // Standalone price preview
    if (!job_id) {
      const pagesNum = Math.max(1, Math.min(Number(pages) || 1, pricing.max_pages));
      const ratePaise = is_color
        ? (pricing.color_price_paise || Math.round(pricing.color_price_per_page * 100))
        : (pricing.bw_price_paise || Math.round(pricing.bw_price_per_page * 100));
      const servicePaise = Math.round(pricing.service_charge * 100);
      const minOrderPaise = Math.round(pricing.min_order_amount * 100);

      const basePaise = pagesNum * copiesNum * ratePaise;
      const totalPaise = Math.max(minOrderPaise, basePaise + servicePaise);
      const finalAmountRupees = totalPaise / 100;

      return NextResponse.json({
        success: true,
        amount: finalAmountRupees,
        amount_paise: totalPaise,
        total_amount: finalAmountRupees,
        breakdown: {
          organization_id: targetOrgId,
          pages_total: pagesNum,
          effective_pages: pagesNum,
          copies: copiesNum,
          rate_per_page: ratePaise / 100,
          rate_paise: ratePaise,
          service_charge: pricing.service_charge,
          is_color: Boolean(is_color),
        },
      });
    }

    if (!job) {
      const fallbackPages = Math.max(1, Math.min(Number(pages) || 1, pricing.max_pages));
      const ratePaise = is_color
        ? (pricing.color_price_paise || Math.round(pricing.color_price_per_page * 100))
        : (pricing.bw_price_paise || Math.round(pricing.bw_price_per_page * 100));
      const servicePaise = Math.round(pricing.service_charge * 100);
      const minOrderPaise = Math.round(pricing.min_order_amount * 100);

      const basePaise = fallbackPages * copiesNum * ratePaise;
      const totalPaise = Math.max(minOrderPaise, basePaise + servicePaise);
      const finalAmountRupees = totalPaise / 100;

      // Reconstruct job in memory for subsequent API steps (like create-order)
      if (job_id) {
        job = store.createJob({
          id: job_id,
          organization_id: targetOrgId,
          session_id: 'recovered_session',
          kiosk_id: 'GITAM-SPK-001',
          pages_total: fallbackPages,
          pages_selected: pages_selected || 'All',
          copies: copiesNum,
          is_color: Boolean(is_color),
          is_duplex: Boolean(is_duplex),
          calculated_amount: finalAmountRupees,
          amount_paise: totalPaise,
          status: 'UPLOAD_COMPLETE',
        });
      }

      return NextResponse.json({
        success: true,
        amount: finalAmountRupees,
        amount_paise: totalPaise,
        total_amount: finalAmountRupees,
        breakdown: {
          organization_id: targetOrgId,
          pages_total: fallbackPages,
          effective_pages: fallbackPages,
          copies: copiesNum,
          rate_per_page: ratePaise / 100,
          rate_paise: ratePaise,
          service_charge: pricing.service_charge,
          is_color: Boolean(is_color),
        },
      });
    }

    // Calculate effective pages
    let effectivePages = job.pages_total;
    if (pages_selected && pages_selected.toLowerCase() !== 'all') {
      const ranges = pages_selected.split(',');
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
      if (count > 0 && count <= job.pages_total) {
        effectivePages = count;
      }
    }

    // Rate selection in exact integer paise
    const ratePaise = is_color
      ? (pricing.color_price_paise || Math.round(pricing.color_price_per_page * 100))
      : (pricing.bw_price_paise || Math.round(pricing.bw_price_per_page * 100));
    const servicePaise = Math.round(pricing.service_charge * 100);
    const minOrderPaise = Math.round(pricing.min_order_amount * 100);

    const basePaise = effectivePages * copiesNum * ratePaise;
    const totalPaise = Math.max(minOrderPaise, basePaise + servicePaise);
    const finalAmountRupees = totalPaise / 100;

    // Update job settings and freeze pricing snapshot
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

    return NextResponse.json({
      success: true,
      amount: finalAmountRupees,
      amount_paise: totalPaise,
      total_amount: finalAmountRupees,
      breakdown: {
        organization_id: targetOrgId,
        pages_total: job.pages_total,
        effective_pages: effectivePages,
        copies: copiesNum,
        rate_per_page: ratePaise / 100,
        rate_paise: ratePaise,
        service_charge: pricing.service_charge,
        is_color: job.is_color,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
