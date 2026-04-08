import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
});

/** Viewing deposit: ₦5,000 represented in kobo for NGN, or £50 in GBP pence */
const VIEWING_DEPOSIT_AMOUNT_PENCE = 5000; // £50 in GBP
const VIEWING_DEPOSIT_CURRENCY = 'gbp';

export const StripeService = {
  /**
   * Create a Stripe Checkout Session for a viewing deposit.
   * Idempotency key scoped to the viewingId — retrying the same session
   * creation returns the same session rather than creating a duplicate charge.
   */
  async createViewingDepositSession(params: {
    tenantEmail: string;
    propertyTitle: string;
    propertyId: string;
    viewingId: string;
    tenantId: string;
    landlordId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    return stripe.checkout.sessions.create(
      {
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: params.tenantEmail,
        line_items: [
          {
            price_data: {
              currency: VIEWING_DEPOSIT_CURRENCY,
              unit_amount: VIEWING_DEPOSIT_AMOUNT_PENCE,
              product_data: {
                name: 'Viewing Deposit',
                description: `Refundable deposit for viewing: ${params.propertyTitle}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          viewingId: params.viewingId,
          propertyId: params.propertyId,
          tenantId: params.tenantId,
          landlordId: params.landlordId,
          type: 'viewing_deposit',
        },
        payment_intent_data: {
          metadata: {
            viewingId: params.viewingId,
            propertyId: params.propertyId,
            tenantId: params.tenantId,
            landlordId: params.landlordId,
          },
          description: `Viewing deposit for ${params.propertyTitle}`,
        },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      {
        // Idempotency key: same viewingId always produces the same session
        // Safe to retry on network errors without risk of double-charging
        idempotencyKey: `stripe_session_deposit_${params.viewingId}`,
      },
    );
  },

  /**
   * Refund a viewing deposit back to the tenant.
   * Idempotency key ensures multiple calls for the same viewing
   * produce exactly one refund, never a duplicate.
   */
  async refundViewingDeposit(
    paymentIntentId: string,
    reason: 'viewing_completed' | 'landlord_cancelled' | 'dispute',
    viewingId: string,
  ): Promise<Stripe.Refund> {
    return stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: reason === 'dispute' ? 'fraudulent' : 'requested_by_customer',
        metadata: { reason, viewingId },
      },
      {
        idempotencyKey: `stripe_refund_${viewingId}`,
      },
    );
  },

  /**
   * Create a Stripe Checkout Session for a subscription plan.
   * Requires a pre-configured Stripe Price ID (set via env vars).
   * Idempotency key scoped to landlordId + priceId — retrying is safe.
   */
  async createSubscriptionCheckout(params: {
    landlordEmail: string;
    landlordId: string;
    priceId: string;
    planName: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    return stripe.checkout.sessions.create(
      {
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: params.landlordEmail,
        line_items: [{ price: params.priceId, quantity: 1 }],
        metadata: {
          landlordId: params.landlordId,
          plan: params.planName,
          type: 'subscription',
        },
        subscription_data: {
          metadata: { landlordId: params.landlordId, plan: params.planName },
        },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      {
        idempotencyKey: `stripe_sub_${params.landlordId}_${params.priceId}`,
      },
    );
  },

  /**
   * Create a Stripe Billing Portal session so a subscriber can
   * manage, upgrade, cancel, or download invoices without any custom UI.
   */
  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<Stripe.BillingPortal.Session> {
    return stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
  },

  /**
   * Construct and verify a Stripe webhook event.
   * Raw body (Buffer) required — not the JSON-parsed body.
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  },
};
