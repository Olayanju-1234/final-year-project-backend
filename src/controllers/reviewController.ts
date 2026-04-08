import type { Request, Response } from 'express';
import { Review } from '@/models/Review';
import { Viewing } from '@/models/Viewing';
import { User } from '@/models/User';
import { writeAuditLog } from '@/utils/auditLogger';
import { logger } from '@/utils/logger';

/**
 * POST /api/v1/reviews
 *
 * Submit a review for a property after a completed viewing.
 * One review per viewing — enforced by unique index on viewingId.
 */
export const submitReview = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;
    const { propertyId, viewingId, rating, comment } = req.body;

    if (!propertyId || !viewingId || !rating) {
      res.status(400).json({ success: false, message: 'propertyId, viewingId and rating are required' });
      return;
    }
    if (rating < 1 || rating > 5) {
      res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
      return;
    }

    // Verify the viewing exists, belongs to this tenant, and is completed
    const viewing = await Viewing.findOne({ _id: viewingId, tenantId }).lean();
    if (!viewing) {
      res.status(404).json({ success: false, message: 'Viewing not found' });
      return;
    }
    if (viewing.status !== 'completed') {
      res.status(422).json({ success: false, message: 'Reviews can only be submitted after a completed viewing' });
      return;
    }

    // Check for duplicate (DB unique index also protects this, but give a cleaner error)
    const existing = await Review.findOne({ viewingId }).lean();
    if (existing) {
      res.status(409).json({ success: false, message: 'You have already reviewed this viewing' });
      return;
    }

    const review = await Review.create({ tenantId, propertyId, viewingId, rating, comment });

    await writeAuditLog({
      action: 'review.submitted',
      actorId: tenantId,
      actorType: 'tenant',
      targetId: String(propertyId),
      targetType: 'Property',
      metadata: { viewingId: String(viewingId), rating, hasComment: !!comment },
      ip: req.ip,
    });

    logger.info('Review submitted', { reviewId: review._id, tenantId, propertyId, rating });

    res.status(201).json({ success: true, message: 'Review submitted', data: review });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ success: false, message: 'You have already reviewed this viewing' });
      return;
    }
    logger.error('Failed to submit review', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to submit review' });
  }
};

/**
 * GET /api/v1/reviews/property/:propertyId
 *
 * Get all reviews for a property. Public endpoint.
 */
export const getPropertyReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const { propertyId } = req.params;

    const reviews = await Review.find({ propertyId })
      .populate<{ tenantId: { name: string } }>('tenantId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const total = reviews.length;
    const averageRating = total > 0
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / total) * 10) / 10
      : null;

    const formatted = reviews.map((r) => ({
      _id: r._id,
      tenantId: r.tenantId,
      tenantName: (r.tenantId as any)?.name ?? 'Anonymous',
      propertyId: r.propertyId,
      viewingId: r.viewingId,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: formatted,
      meta: { total, averageRating },
    });
  } catch (err: any) {
    logger.error('Failed to fetch property reviews', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
};

/**
 * GET /api/v1/reviews/my
 *
 * Get all reviews submitted by the authenticated tenant.
 */
export const getMyReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;

    const reviews = await Review.find({ tenantId })
      .populate('propertyId', 'title location')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: reviews });
  } catch (err: any) {
    logger.error('Failed to fetch tenant reviews', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
};
