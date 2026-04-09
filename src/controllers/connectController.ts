import type { Request, Response } from 'express';
import { StripeService } from '@/services/StripeService';
import { User } from '@/models/User';
import { writeAuditLog } from '@/utils/auditLogger';
import { logger } from '@/utils/logger';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/**
 * POST /api/v1/payments/connect/onboard
 *
 * Starts the Stripe Connect Express onboarding flow for a landlord.
 * Creates the Stripe account if one doesn't exist, then returns
 * a single-use Account Link URL where the landlord completes KYC + bank setup.
 *
 * After onboarding, Stripe redirects to:
 *   /property-manager-dashboard?tab=account&connect=complete
 * If the link expires, Stripe hits refreshUrl which re-calls this endpoint.
 */
export const startConnectOnboarding = async (req: Request, res: Response): Promise<void> => {
  try {
    const landlordId = (req as any).user.id;
    const landlordEmail = (req as any).user.email;

    let user = await User.findById(landlordId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    // Create a Stripe Connect account if landlord doesn't have one yet
    if (!user.stripe_account_id) {
      const account = await StripeService.createConnectedAccount({ landlordEmail, landlordId });
      user = await User.findByIdAndUpdate(
        landlordId,
        { stripe_account_id: account.id, stripe_onboarding_complete: false },
        { new: true },
      );
    }

    const accountLink = await StripeService.createAccountLink({
      accountId: user!.stripe_account_id!,
      returnUrl: `${APP_URL}/property-manager-dashboard?tab=account&connect=complete`,
      refreshUrl: `${APP_URL}/property-manager-dashboard?tab=account&connect=refresh`,
    });

    await writeAuditLog({
      action: 'connect.onboarding_started',
      actorId: landlordId,
      actorType: 'landlord',
      targetId: user!.stripe_account_id,
      targetType: 'StripeConnectAccount',
      metadata: { step: 'onboarding_started' },
    });

    logger.info('Connect onboarding started', { landlordId, accountId: user!.stripe_account_id });
    res.status(200).json({ success: true, data: { onboarding_url: accountLink.url } });
  } catch (err: any) {
    logger.error('Error starting Connect onboarding', { error: err.message });
    // Surface the Stripe error so it's visible in the dashboard error toast
    const hint = err.message?.includes('not enabled for Connect')
      ? 'Stripe Connect is not enabled on this account. Enable it at dashboard.stripe.com → Settings → Connect.'
      : err.message;
    res.status(500).json({ success: false, message: hint || 'Failed to start payout setup' });
  }
};

/**
 * GET /api/v1/payments/connect/status
 *
 * Returns the landlord's Stripe Connect account status:
 * - connected (account exists + onboarding complete)
 * - pending (account created but onboarding incomplete)
 * - none (no account yet)
 *
 * Also syncs the onboarding_complete flag from Stripe in real time.
 */
export const getConnectStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const landlordId = (req as any).user.id;
    const user = await User.findById(landlordId).lean();

    if (!user?.stripe_account_id) {
      res.status(200).json({ success: true, data: { status: 'none', accountId: null } });
      return;
    }

    // Refresh from Stripe to get current onboarding state
    const account = await StripeService.getConnectedAccount(user.stripe_account_id);
    const isComplete = account.details_submitted && !account.requirements?.currently_due?.length;

    // Sync our DB if status changed
    if (isComplete !== user.stripe_onboarding_complete) {
      await User.findByIdAndUpdate(landlordId, { stripe_onboarding_complete: isComplete });
    }

    res.status(200).json({
      success: true,
      data: {
        status: isComplete ? 'connected' : 'pending',
        accountId: user.stripe_account_id,
        payoutsEnabled: account.payouts_enabled,
        chargesEnabled: account.charges_enabled,
        requirements: account.requirements?.currently_due ?? [],
      },
    });
  } catch (err: any) {
    logger.error('Error fetching Connect status', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch payout status' });
  }
};
