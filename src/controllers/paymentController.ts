import { Request, Response } from 'express';
import Stripe from 'stripe';
import { StripeService } from '@/services/StripeService';
import { ViewingPayment } from '@/models/ViewingPayment';
import { Viewing } from '@/models/Viewing';
import { Property } from '@/models/Property';
import { logger } from '@/utils/logger';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const API_URL = process.env.BASE_URL ?? 'http://localhost:3001';

// ─── Deposit Checkout ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/viewing/:viewingId/deposit
 *
 * Creates a £50 Stripe Checkout Session for a viewing deposit.
 * The deposit is fully refunded after the viewing is marked as completed.
 * If the tenant no-shows, the deposit is forfeited.
 */
export const createViewingDepositSession = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { viewingId } = req.params;
    const tenantId = (req as any).user.id;

    const viewing = await Viewing.findById(viewingId)
      .populate<{ propertyId: { title: string; landlordId: string } }>('propertyId', 'title landlordId')
      .lean();

    if (!viewing) {
      res.status(404).json({ success: false, message: 'Viewing not found' });
      return;
    }

    if (String(viewing.tenantId) !== String(tenantId)) {
      res.status(403).json({ success: false, message: 'Not authorised for this viewing' });
      return;
    }

    if (viewing.status !== 'confirmed') {
      res.status(422).json({
        success: false,
        message: 'Deposit can only be paid for confirmed viewings',
      });
      return;
    }

    // Prevent double payment
    const existing = await ViewingPayment.findOne({ viewingId }).lean();
    if (existing?.status === 'paid') {
      res.status(409).json({ success: false, message: 'Deposit already paid for this viewing' });
      return;
    }

    const property = viewing.propertyId as any;
    const tenantEmail = (req as any).user.email;

    const session = await StripeService.createViewingDepositSession({
      tenantEmail,
      propertyTitle: property.title,
      propertyId: String(viewing.propertyId),
      viewingId: String(viewingId),
      tenantId: String(tenantId),
      landlordId: String(property.landlordId),
      successUrl: `${APP_URL}/viewings/${viewingId}/deposit-success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${APP_URL}/viewings/${viewingId}`,
    });

    // Create a pending payment record (will be confirmed via webhook)
    await ViewingPayment.findOneAndUpdate(
      { viewingId },
      {
        viewingId,
        propertyId: viewing.propertyId,
        tenantId,
        landlordId: property.landlordId,
        amount: 50,
        currency: 'gbp',
        status: 'pending',
        stripe_session_id: session.id,
      },
      { upsert: true, new: true },
    );

    res.status(201).json({
      success: true,
      data: {
        checkout_url: session.url,
        session_id: session.id,
        amount: 50,
        currency: 'GBP',
        expires_at: session.expires_at,
      },
    });
  } catch (error: any) {
    logger.error('Error creating viewing deposit session:', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to create payment session' });
  }
};

/**
 * GET /api/v1/payments/viewing/:viewingId/deposit
 *
 * Returns the payment status for a viewing's deposit.
 */
export const getViewingDepositStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { viewingId } = req.params;
    const userId = (req as any).user.id;

    const payment = await ViewingPayment.findOne({ viewingId }).lean();

    if (!payment) {
      res.status(404).json({ success: false, message: 'No deposit found for this viewing' });
      return;
    }

    // Only the tenant or landlord involved may see this
    if (
      String(payment.tenantId) !== String(userId) &&
      String(payment.landlordId) !== String(userId)
    ) {
      res.status(403).json({ success: false, message: 'Not authorised' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency.toUpperCase(),
        paid_at: payment.updatedAt,
        refund_reason: payment.refund_reason,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching deposit status:', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch payment status' });
  }
};

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/webhook
 *
 * Receives Stripe events. Raw body is required for signature verification.
 * Must be registered BEFORE express.json() in the middleware chain.
 */
export const handleStripeWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const signature = req.headers['stripe-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer;

  if (!signature || !rawBody) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = StripeService.constructWebhookEvent(rawBody, signature);
  } catch (err: any) {
    logger.error(`Stripe webhook signature verification failed: ${err.message}`);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === 'viewing_deposit') {
          await handleViewingDepositPaid(session);
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === 'viewing_deposit') {
          await ViewingPayment.deleteOne({ stripe_session_id: session.id, status: 'pending' });
        }
        break;
      }

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error(`Webhook processing error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

// ─── Internal Handlers ────────────────────────────────────────────────────────

async function handleViewingDepositPaid(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { viewingId } = session.metadata ?? {};
  if (!viewingId) return;

  // Idempotency: skip if already marked paid
  const existing = await ViewingPayment.findOne({ stripe_session_id: session.id }).lean();
  if (existing?.status === 'paid') return;

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  await ViewingPayment.updateOne(
    { stripe_session_id: session.id },
    {
      status: 'paid',
      stripe_payment_intent_id: paymentIntentId ?? null,
    },
  );

  logger.info(`Viewing deposit confirmed for viewingId=${viewingId}, session=${session.id}`);
}
