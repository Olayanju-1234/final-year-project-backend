import type { Request, Response } from 'express';
import { Waitlist } from '@/models/Waitlist';
import { Property } from '@/models/Property';
import { logger } from '@/utils/logger';

/**
 * POST /api/v1/waitlist/:propertyId
 * Tenant joins the waitlist for an occupied property.
 * Idempotent: joining twice returns 200 both times.
 */
export const joinWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;
    const { propertyId } = req.params;

    const property = await Property.findById(propertyId).lean();
    if (!property) {
      res.status(404).json({ success: false, message: 'Property not found' });
      return;
    }

    // upsert — joining twice is idempotent
    await Waitlist.findOneAndUpdate(
      { propertyId, tenantId },
      { propertyId, tenantId },
      { upsert: true, new: true },
    );

    const position = await Waitlist.countDocuments({ propertyId, notified: false });

    logger.info('Tenant joined waitlist', { tenantId, propertyId });
    res.status(200).json({
      success: true,
      message: `You are #${position} on the waitlist for "${property.title}". We'll notify you when it becomes available.`,
      data: { position },
    });
  } catch (err: any) {
    if (err.code === 11000) {
      // Already on waitlist — return current position
      const position = await Waitlist.countDocuments({ propertyId: req.params.propertyId, notified: false });
      res.status(200).json({ success: true, message: 'Already on waitlist', data: { position } });
      return;
    }
    logger.error('Error joining waitlist', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to join waitlist' });
  }
};

/**
 * DELETE /api/v1/waitlist/:propertyId
 * Tenant leaves the waitlist.
 */
export const leaveWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;
    const { propertyId } = req.params;

    await Waitlist.deleteOne({ propertyId, tenantId });
    res.status(200).json({ success: true, message: 'Removed from waitlist' });
  } catch (err: any) {
    logger.error('Error leaving waitlist', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to leave waitlist' });
  }
};

/**
 * GET /api/v1/waitlist/my
 * Returns all waitlist entries for the authenticated tenant.
 */
export const getMyWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;
    const entries = await Waitlist.find({ tenantId })
      .populate('propertyId', 'title location status images rent')
      .lean();

    res.status(200).json({ success: true, data: entries });
  } catch (err: any) {
    logger.error('Error fetching waitlist', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch waitlist' });
  }
};

/**
 * GET /api/v1/waitlist/status/:propertyId
 * Check if the current tenant is on the waitlist for a property.
 */
export const getWaitlistStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;
    const { propertyId } = req.params;

    const entry = await Waitlist.findOne({ propertyId, tenantId }).lean();
    const position = entry
      ? await Waitlist.countDocuments({ propertyId, notified: false, createdAt: { $lte: entry.createdAt } })
      : null;

    res.status(200).json({ success: true, data: { onWaitlist: !!entry, position } });
  } catch (err: any) {
    logger.error('Error checking waitlist status', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to check waitlist status' });
  }
};
