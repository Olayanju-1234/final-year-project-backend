import type { Request, Response } from 'express';
import { Property } from '@/models/Property';
import { Viewing } from '@/models/Viewing';
import { ViewingPayment } from '@/models/ViewingPayment';
import { Review } from '@/models/Review';
import { logger } from '@/utils/logger';

/**
 * GET /api/v1/analytics/landlord
 *
 * Returns aggregated analytics for the authenticated landlord:
 * - Property summary (total, available, occupied)
 * - Viewing funnel (pending → confirmed → completed)
 * - Revenue (total deposits received)
 * - Viewing conversion rate
 * - Average rating across all properties
 * - Monthly viewing requests (last 6 months)
 */
export const getLandlordAnalytics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const landlordId = (req as any).user.id;

    const [properties, viewings, payments] = await Promise.all([
      Property.find({ landlordId }).select('status rent inquiries _id').lean(),
      Viewing.find({ landlordId }).select('status createdAt').lean(),
      ViewingPayment.find({ landlordId, status: 'paid' }).select('amount currency createdAt').lean(),
    ]);

    const propertyIds = properties.map((p: any) => p._id);
    const reviews = propertyIds.length
      ? await Review.find({ propertyId: { $in: propertyIds } }).select('rating').lean()
      : [];

    // Property summary
    const totalProperties = properties.length;
    const availableProperties = properties.filter((p: any) => p.status === 'available').length;
    const occupiedProperties = properties.filter((p: any) => p.status === 'occupied').length;
    const totalInquiries = properties.reduce((s: number, p: any) => s + (p.inquiries ?? 0), 0);

    // Viewing funnel
    const totalViewings = viewings.length;
    const confirmedViewings = viewings.filter((v: any) => ['confirmed', 'completed'].includes(v.status)).length;
    const completedViewings = viewings.filter((v: any) => v.status === 'completed').length;
    const conversionRate = totalViewings > 0 ? Math.round((completedViewings / totalViewings) * 100) : 0;

    // Revenue
    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const revenueByCurrency: Record<string, number> = {};
    for (const p of payments) {
      revenueByCurrency[p.currency.toUpperCase()] = (revenueByCurrency[p.currency.toUpperCase()] ?? 0) + p.amount;
    }

    // Rating
    const avgRating = reviews.length
      ? Math.round((reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length) * 10) / 10
      : null;

    // Monthly viewings — last 6 months
    const now = new Date();
    const months: { month: string; count: number; confirmed: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthViewings = viewings.filter((v: any) => {
        const c = new Date(v.createdAt);
        return c >= monthStart && c <= monthEnd;
      });
      months.push({
        month: label,
        count: monthViewings.length,
        confirmed: monthViewings.filter((v: any) => ['confirmed', 'completed'].includes(v.status)).length,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        properties: { total: totalProperties, available: availableProperties, occupied: occupiedProperties, totalInquiries },
        viewings: { total: totalViewings, confirmed: confirmedViewings, completed: completedViewings, conversionRate },
        revenue: { total: totalRevenue, byCurrency: revenueByCurrency },
        rating: { avg: avgRating, total: reviews.length },
        monthlyViewings: months,
      },
    });
  } catch (err: any) {
    logger.error('Error fetching landlord analytics', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

/**
 * GET /api/v1/analytics/tenant
 *
 * Returns aggregated analytics for the authenticated tenant:
 * - Total viewings and status breakdown
 * - Total deposits paid / refunded
 * - Average match score (derived from viewing requests vs match count)
 * - Monthly viewing requests (last 6 months)
 */
export const getTenantAnalytics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;

    const [viewings, payments] = await Promise.all([
      Viewing.find({ tenantId }).select('status createdAt').lean(),
      ViewingPayment.find({ tenantId }).select('amount currency status createdAt').lean(),
    ]);

    const totalViewings = viewings.length;
    const confirmedViewings = viewings.filter((v: any) => v.status === 'confirmed').length;
    const completedViewings = viewings.filter((v: any) => v.status === 'completed').length;
    const cancelledViewings = viewings.filter((v: any) => v.status === 'cancelled').length;

    const totalPaid = payments.filter((p: any) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const totalRefunded = payments.filter((p: any) => p.status === 'refunded').reduce((s, p) => s + p.amount, 0);
    const primaryCurrency = payments[0]?.currency?.toUpperCase() ?? 'GBP';

    // Monthly viewings — last 6 months
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      months.push({
        month: label,
        count: viewings.filter((v: any) => {
          const c = new Date(v.createdAt);
          return c >= monthStart && c <= monthEnd;
        }).length,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        viewings: { total: totalViewings, confirmed: confirmedViewings, completed: completedViewings, cancelled: cancelledViewings },
        payments: { totalPaid, totalRefunded, currency: primaryCurrency },
        monthlyViewings: months,
      },
    });
  } catch (err: any) {
    logger.error('Error fetching tenant analytics', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};
