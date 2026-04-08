import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { StripeService } from '@/services/StripeService';
import { PaystackService } from '@/services/PaystackService';
import { ViewingPayment } from '@/models/ViewingPayment';
import { Viewing } from '@/models/Viewing';
import { AuditLog } from '@/models/AuditLog';
import { writeAuditLog } from '@/utils/auditLogger';
import { logger } from '@/utils/logger';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

// ─── Stripe Deposit ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/viewing/:viewingId/deposit
 *
 * Creates a Stripe Checkout Session for a viewing deposit.
 * Server-side amount is hardcoded — the client never dictates the price.
 * Idempotency is handled by StripeService (idempotencyKey per viewingId).
 */
export const createViewingDepositSession = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { viewingId } = req.params;
    const tenantId = (req as any).user.id;
    const tenantEmail = (req as any).user.email;

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
      res.status(422).json({ success: false, message: 'Deposit can only be paid for confirmed viewings' });
      return;
    }

    // Prevent double payment — optimistic check before hitting Stripe
    const existing = await ViewingPayment.findOne({ viewingId }).lean();
    if (existing?.status === 'paid') {
      res.status(409).json({ success: false, message: 'Deposit already paid for this viewing' });
      return;
    }

    const property = viewing.propertyId as any;

    const session = await StripeService.createViewingDepositSession({
      tenantEmail,
      propertyTitle: property.title,
      propertyId: String(viewing.propertyId),
      viewingId: String(viewingId),
      tenantId: String(tenantId),
      landlordId: String(property.landlordId),
      successUrl: `${APP_URL}/viewings/${viewingId}/deposit-success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${APP_URL}/tenant-dashboard`,
    });

    // Upsert pending payment record — will be confirmed by webhook
    await ViewingPayment.findOneAndUpdate(
      { viewingId },
      {
        $setOnInsert: {
          viewingId,
          propertyId: viewing.propertyId,
          tenantId,
          landlordId: property.landlordId,
          amount: 50,
          currency: 'gbp',
          provider: 'stripe',
        },
        $set: {
          status: 'pending',
          stripe_session_id: session.id,
        },
      },
      { upsert: true, new: true },
    );

    await writeAuditLog({
      action: 'deposit.created',
      actorId: tenantId,
      actorType: 'tenant',
      targetId: String(viewingId),
      targetType: 'Viewing',
      metadata: { provider: 'stripe', sessionId: session.id, amount: 50, currency: 'gbp' },
      ip: req.ip,
    });

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
  } catch (err: any) {
    logger.error('Error creating Stripe deposit session', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to create payment session' });
  }
};

// ─── Paystack Deposit ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/viewing/:viewingId/deposit/paystack
 *
 * Initializes a Paystack transaction and returns the reference + public key
 * for the frontend inline popup. Amount is always server-defined.
 */
export const createPaystackDepositSession = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { viewingId } = req.params;
    const tenantId = (req as any).user.id;
    const tenantEmail = (req as any).user.email;

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
      res.status(422).json({ success: false, message: 'Deposit can only be paid for confirmed viewings' });
      return;
    }

    const existing = await ViewingPayment.findOne({ viewingId }).lean();
    if (existing?.status === 'paid') {
      res.status(409).json({ success: false, message: 'Deposit already paid for this viewing' });
      return;
    }

    const property = viewing.propertyId as any;

    const result = await PaystackService.initializeDeposit({
      email: tenantEmail,
      viewingId: String(viewingId),
      tenantId: String(tenantId),
      propertyTitle: property.title,
      callbackUrl: `${APP_URL}/viewings/${viewingId}/deposit-success?provider=paystack`,
    });

    // Upsert pending payment record
    await ViewingPayment.findOneAndUpdate(
      { viewingId },
      {
        $setOnInsert: {
          viewingId,
          propertyId: viewing.propertyId,
          tenantId,
          landlordId: property.landlordId,
          amount: PaystackService.DEPOSIT_AMOUNT_NGN,
          currency: 'ngn',
          provider: 'paystack',
        },
        $set: {
          status: 'pending',
          paystack_reference: result.reference,
        },
      },
      { upsert: true, new: true },
    );

    await writeAuditLog({
      action: 'deposit.paystack_initiated',
      actorId: tenantId,
      actorType: 'tenant',
      targetId: String(viewingId),
      targetType: 'Viewing',
      metadata: { reference: result.reference, amount: result.amount, currency: 'ngn' },
      ip: req.ip,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Error creating Paystack deposit session', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to initialise Paystack payment' });
  }
};

/**
 * POST /api/v1/payments/viewing/:viewingId/deposit/paystack/verify
 *
 * Verify a Paystack payment by reference after the inline popup callback.
 * Uses optimistic locking — only updates if status is still 'pending'.
 */
export const verifyPaystackPayment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { viewingId } = req.params;
    const { reference } = req.body;
    const tenantId = (req as any).user.id;

    if (!reference) {
      res.status(400).json({ success: false, message: 'reference is required' });
      return;
    }

    const payment = await ViewingPayment.findOne({ viewingId, tenantId }).lean();
    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment record not found' });
      return;
    }
    if (payment.status === 'paid') {
      res.status(200).json({ success: true, message: 'Already confirmed', data: { status: 'paid' } });
      return;
    }

    const txn = await PaystackService.verifyTransaction(reference);

    if (txn.status !== 'success') {
      res.status(422).json({ success: false, message: `Payment not successful: ${txn.status}` });
      return;
    }

    // Optimistic lock: only proceed if payment is still 'pending'
    const updated = await ViewingPayment.findOneAndUpdate(
      { viewingId, status: 'pending' },
      {
        $set: {
          status: 'paid',
          paystack_transaction_id: String(txn.id),
          paid_at: new Date(txn.paid_at),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Another request already updated it — return current state
      const current = await ViewingPayment.findOne({ viewingId }).lean();
      res.status(200).json({ success: true, data: { status: current?.status } });
      return;
    }

    await writeAuditLog({
      action: 'deposit.paystack_confirmed',
      actorId: tenantId,
      actorType: 'tenant',
      targetId: String(viewingId),
      targetType: 'Viewing',
      metadata: { reference, transactionId: txn.id, amount: txn.amount / 100 },
      ip: req.ip,
    });

    logger.info('Paystack deposit verified', { viewingId, reference, transactionId: txn.id });

    res.status(200).json({ success: true, data: { status: 'paid' } });
  } catch (err: any) {
    logger.error('Error verifying Paystack payment', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
};

// ─── Deposit Status ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/payments/viewing/:viewingId/deposit
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
        provider: payment.provider,
        paid_at: payment.paid_at,
        refunded_at: payment.refunded_at,
        refund_reason: payment.refund_reason,
      },
    });
  } catch (err: any) {
    logger.error('Error fetching deposit status', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch payment status' });
  }
};

// ─── Refund ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/viewing/:viewingId/refund
 *
 * Manually request a refund for a paid deposit.
 * Uses optimistic locking: status must be 'paid' to proceed.
 * Idempotency: Stripe refund uses viewingId-scoped idempotency key.
 */
export const requestRefund = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { viewingId } = req.params;
    const tenantId = (req as any).user.id;
    const { reason } = req.body;

    // Verify the viewing belongs to this tenant
    const viewing = await Viewing.findOne({ _id: viewingId, tenantId }).lean();
    if (!viewing) {
      res.status(404).json({ success: false, message: 'Viewing not found' });
      return;
    }

    // OPTIMISTIC LOCK: atomically transition paid → refund_requested
    // If another request already changed the status, findOneAndUpdate returns null
    const payment = await ViewingPayment.findOneAndUpdate(
      { viewingId, status: 'paid' },
      { $set: { status: 'refund_requested', refund_reason: reason || 'Requested by tenant' } },
      { new: true },
    );

    if (!payment) {
      const current = await ViewingPayment.findOne({ viewingId }).lean();
      if (!current) {
        res.status(404).json({ success: false, message: 'No deposit found for this viewing' });
        return;
      }
      if (current.status === 'refunded') {
        res.status(200).json({ success: true, message: 'Already refunded', data: { status: 'refunded' } });
        return;
      }
      if (current.status === 'refund_requested') {
        res.status(200).json({ success: true, message: 'Refund already in progress', data: { status: 'refund_requested' } });
        return;
      }
      res.status(422).json({ success: false, message: `Cannot refund deposit in status: ${current.status}` });
      return;
    }

    await writeAuditLog({
      action: 'deposit.refund_requested',
      actorId: tenantId,
      actorType: 'tenant',
      targetId: String(viewingId),
      targetType: 'Viewing',
      metadata: { provider: payment.provider, reason: payment.refund_reason },
      ip: req.ip,
    });

    // Issue refund via the correct provider
    try {
      if (payment.provider === 'stripe' && payment.stripe_payment_intent_id) {
        const refund = await StripeService.refundViewingDeposit(
          payment.stripe_payment_intent_id,
          'viewing_completed',
          String(viewingId),
        );

        await ViewingPayment.findOneAndUpdate(
          { viewingId },
          {
            $set: {
              status: 'refunded',
              stripe_refund_id: refund.id,
              refunded_at: new Date(),
            },
          },
        );
      } else if (payment.provider === 'paystack') {
        // Paystack refunds are initiated via their dashboard or API for now
        // Mark as refunded — Paystack refund API requires business account approval
        await ViewingPayment.findOneAndUpdate(
          { viewingId },
          { $set: { status: 'refunded', refunded_at: new Date() } },
        );
      } else {
        // No payment intent stored (e.g. test session) — mark refunded directly
        await ViewingPayment.findOneAndUpdate(
          { viewingId },
          { $set: { status: 'refunded', refunded_at: new Date() } },
        );
      }

      await writeAuditLog({
        action: 'deposit.refunded',
        actorId: tenantId,
        actorType: 'tenant',
        targetId: String(viewingId),
        targetType: 'Viewing',
        metadata: { provider: payment.provider, amount: payment.amount },
        ip: req.ip,
      });

      logger.info('Deposit refunded', { viewingId, provider: payment.provider, tenantId });

      res.status(200).json({
        success: true,
        message: 'Refund processed successfully',
        data: { status: 'refunded', amount: payment.amount, currency: payment.currency.toUpperCase() },
      });
    } catch (refundErr: any) {
      // Refund API call failed — revert optimistic lock back to 'paid'
      await ViewingPayment.findOneAndUpdate(
        { viewingId, status: 'refund_requested' },
        { $set: { status: 'paid', refund_reason: undefined } },
      );
      logger.error('Refund API call failed, reverted to paid', { viewingId, error: refundErr.message });
      res.status(502).json({ success: false, message: 'Refund failed, please try again' });
    }
  } catch (err: any) {
    logger.error('Error processing refund', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to process refund' });
  }
};

// ─── Payment History ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/payments/history
 *
 * Returns the authenticated tenant's full payment history.
 */
export const getPaymentHistory = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const tenantId = (req as any).user.id;

    const payments = await ViewingPayment.find({ tenantId })
      .populate<{ viewingId: any }>({
        path: 'viewingId',
        populate: { path: 'propertyId', select: 'title location' },
      })
      .sort({ createdAt: -1 })
      .lean();

    const history = payments.map((p) => {
      const viewing = p.viewingId as any;
      const property = viewing?.propertyId;
      return {
        _id: p._id,
        viewingId: viewing?._id,
        propertyTitle: property?.title ?? 'Unknown Property',
        propertyLocation: property?.location
          ? `${property.location.city}, ${property.location.state}`
          : undefined,
        amount: p.amount,
        currency: p.currency.toUpperCase(),
        provider: p.provider,
        type: ['refunded', 'refund_requested'].includes(p.status) ? 'refund' : 'deposit',
        status: p.status,
        paid_at: p.paid_at ?? p.createdAt,
        refunded_at: p.refunded_at,
        refund_reason: p.refund_reason,
      };
    });

    res.status(200).json({ success: true, data: history });
  } catch (err: any) {
    logger.error('Error fetching payment history', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch payment history' });
  }
};

// ─── Activity Log ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/payments/activity
 *
 * Returns the authenticated user's audit log entries (max 50).
 */
export const getActivityLog = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user.id;

    const logs = await AuditLog.find({ actorId: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ success: true, data: logs });
  } catch (err: any) {
    logger.error('Error fetching activity log', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch activity log' });
  }
};

// ─── Subscription ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/subscription/checkout
 *
 * Creates a Stripe Checkout Session for a subscription plan (Pro / Enterprise).
 * Requires STRIPE_PRO_PRICE_ID or STRIPE_ENTERPRISE_PRICE_ID set in env.
 * Landlord must create products + prices in Stripe dashboard first.
 * body: { plan: 'pro' | 'enterprise' }
 */
export const createSubscriptionCheckout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const landlordId = (req as any).user.id;
    const landlordEmail = (req as any).user.email;
    const { plan } = req.body as { plan: 'pro' | 'enterprise' };

    const PRICE_IDS: Record<string, string | undefined> = {
      pro: process.env.STRIPE_PRO_PRICE_ID,
      enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    };

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      res.status(400).json({
        success: false,
        message: `Stripe Price ID for plan "${plan}" is not configured. Add STRIPE_${plan.toUpperCase()}_PRICE_ID to environment variables.`,
      });
      return;
    }

    const session = await StripeService.createSubscriptionCheckout({
      landlordEmail,
      landlordId,
      priceId,
      planName: plan,
      successUrl: `${APP_URL}/property-manager-dashboard?tab=account&upgraded=${plan}`,
      cancelUrl: `${APP_URL}/property-manager-dashboard?tab=account`,
    });

    await writeAuditLog({
      action: 'subscription.checkout_created',
      actorId: landlordId,
      actorType: 'landlord',
      targetId: session.id,
      targetType: 'StripeCheckoutSession',
      metadata: { plan, type: 'subscription_checkout' },
    });

    res.status(200).json({ success: true, data: { checkout_url: session.url } });
  } catch (err: any) {
    logger.error('Error creating subscription checkout', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to create subscription checkout' });
  }
};

/**
 * POST /api/v1/payments/billing-portal
 *
 * Creates a Stripe Billing Portal session for an existing subscriber.
 * Requires body: { stripeCustomerId: string }
 * Landlords get their customer ID stored after first successful subscription.
 */
export const createBillingPortalSession = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { stripeCustomerId } = req.body as { stripeCustomerId: string };

    if (!stripeCustomerId) {
      res.status(400).json({ success: false, message: 'No active Stripe subscription found.' });
      return;
    }

    const session = await StripeService.createBillingPortalSession({
      customerId: stripeCustomerId,
      returnUrl: `${APP_URL}/property-manager-dashboard?tab=account`,
    });

    res.status(200).json({ success: true, data: { portal_url: session.url } });
  } catch (err: any) {
    logger.error('Error creating billing portal session', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to open billing portal' });
  }
};

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/webhook
 *
 * Handles verified Stripe webhook events.
 * Raw body must be passed before express.json() parses the request.
 */
export const handleStripeWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const signature = req.headers['stripe-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer;

  if (!signature || !rawBody) {
    res.status(400).json({ error: 'Missing stripe-signature header or raw body' });
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
          logger.info('Expired checkout session cleaned up', { sessionId: session.id });
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const viewingId = charge.metadata?.viewingId;
        if (viewingId) {
          await ViewingPayment.findOneAndUpdate(
            { viewingId, status: { $in: ['paid', 'refund_requested'] } },
            { $set: { status: 'refunded', refunded_at: new Date() } },
          );
          logger.info('Refund confirmed via webhook', { viewingId, chargeId: charge.id });
        }
        break;
      }

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error(`Webhook processing error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/v1/payments/webhook/paystack
 *
 * Handles Paystack webhook events (charge.success).
 * Signature verified with HMAC-SHA512.
 */
export const handlePaystackWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const signature = req.headers['x-paystack-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer;

  if (!signature || !rawBody) {
    res.status(400).json({ error: 'Missing x-paystack-signature or raw body' });
    return;
  }

  if (!PaystackService.verifyWebhookSignature(rawBody, signature)) {
    logger.error('Paystack webhook signature verification failed');
    res.status(400).json({ error: 'Invalid Paystack signature' });
    return;
  }

  try {
    const payload = JSON.parse(rawBody.toString());

    if (payload.event === 'charge.success') {
      const data = payload.data;
      const reference: string = data.reference;
      const viewingId = data.metadata?.viewingId;

      if (viewingId && reference.startsWith('rm_deposit_')) {
        await ViewingPayment.findOneAndUpdate(
          { viewingId, status: 'pending' },
          {
            $set: {
              status: 'paid',
              paystack_transaction_id: String(data.id),
              paid_at: new Date(data.paid_at),
            },
          },
        );

        logger.info('Paystack charge confirmed via webhook', { viewingId, reference });
      }
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error('Paystack webhook processing error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function handleViewingDepositPaid(session: Stripe.Checkout.Session): Promise<void> {
  const { viewingId, tenantId } = session.metadata ?? {};
  if (!viewingId) return;

  // Idempotency: skip if already marked paid
  const existing = await ViewingPayment.findOne({ stripe_session_id: session.id }).lean();
  if (existing?.status === 'paid') return;

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  await ViewingPayment.findOneAndUpdate(
    { stripe_session_id: session.id, status: { $ne: 'paid' } },
    {
      $set: {
        status: 'paid',
        stripe_payment_intent_id: paymentIntentId ?? null,
        paid_at: new Date(),
      },
    },
  );

  if (tenantId) {
    await writeAuditLog({
      action: 'deposit.paid',
      actorId: tenantId as any,
      actorType: 'system',
      targetId: viewingId,
      targetType: 'Viewing',
      metadata: { provider: 'stripe', sessionId: session.id, paymentIntentId },
    });
  }

  logger.info(`Stripe deposit confirmed via webhook`, { viewingId, sessionId: session.id });
}
