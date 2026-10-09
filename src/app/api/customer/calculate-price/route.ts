import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const { job_id, pages, pages_selected, copies, is_color, is_duplex, orientation } =
      await request.json();

    const pricing = store.getPricing();
    const copiesNum = Math.max(1, Math.min(Number(copies) || 1, pricing.max_copies));

    // Standalone price preview (no job_id required)
    if (!job_id) {
      const pagesNum = Math.max(1, Math.min(Number(pages) || 1, pricing.max_pages));
      const ratePerPage = is_color ? pricing.color_price_per_page : pricing.bw_price_per_page;
      const baseTotal = pagesNum * copiesNum * ratePerPage;
      const finalAmount = Math.max(pricing.min_order_amount, baseTotal + pricing.service_charge);
      return NextResponse.json({
        success: true,
        amount: finalAmount,
        total_amount: finalAmount,
        breakdown: {
          pages_total: pagesNum,
          effective_pages: pagesNum,
          copies: copiesNum,
          rate_per_page: ratePerPage,
          service_charge: pricing.service_charge,
          is_color: Boolean(is_color),
        },
      });
    }

    const job = store.getJob(job_id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Calculate effective pages
    let effectivePages = job.pages_total;
    if (pages_selected && pages_selected.toLowerCase() !== 'all') {
      // Parse custom range e.g. "1-3, 5"
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

    // Rate selection
    const ratePerPage = is_color ? pricing.color_price_per_page : pricing.bw_price_per_page;
    const baseTotal = effectivePages * copiesNum * ratePerPage;
    const finalAmount = Math.max(pricing.min_order_amount, baseTotal + pricing.service_charge);

    // Update job settings in store
    job.pages_selected = pages_selected || 'All';
    job.copies = copiesNum;
    job.is_color = Boolean(is_color);
    job.is_duplex = Boolean(is_duplex);
    job.orientation = orientation === 'landscape' ? 'landscape' : 'portrait';
    job.calculated_amount = finalAmount;

    return NextResponse.json({
      success: true,
      amount: finalAmount,
      total_amount: finalAmount,
      breakdown: {
        pages_total: job.pages_total,
        effective_pages: effectivePages,
        copies: copiesNum,
        rate_per_page: ratePerPage,
        service_charge: pricing.service_charge,
        is_color: job.is_color,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
