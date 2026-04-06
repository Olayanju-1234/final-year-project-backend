import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
});

/** Viewing deposit amount in GBP pence (£50.00 = 5000 pence) */
const VIEWING_DEPOSIT_AMOUNT_PENCE = 5000;
const VIEWING_DEPOSIT_CURRENCY = 'gbp';

export const StripeService = {
  /**
   * Create a Stripe Checkout Session for a viewing deposit.
   *
   * The £50 deposit is held by the platform. If the viewing takes place,
   * it is refunded to the tenant. If the tenant no-shows, the platform
   * keeps the deposit to compensate the landlord.
   *
   * A PaymentIntent is created with `capture_method: 'automatic'` so funds
   * are captured immediately and can be refunded programmatically later.
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
    return stripe.checkout.sessions.create({
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
        // Funds captured immediately; we issue a refund programmatically
        // when the viewing is confirmed as completed.
        description: `Viewing deposit for ${params.propertyTitle}`,
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min
    });
  },

  /**
   * Refund a viewing deposit back to the tenant.
   * Called after the viewing is marked as completed.
   */
  async refundViewingDeposit(
    paymentIntentId: string,
    reason: 'viewing_completed' | 'landlord_cancelled' | 'dispute',
  ): Promise<Stripe.Refund> {
    return stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: reason === 'dispute' ? 'fraudulent' : 'requested_by_customer',
      metadata: { reason },
    });
  },

  /**
   * Construct and verify a Stripe webhook event.
   * The raw body (Buffer) must be passed — not the JSON-parsed body.
   */
  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  },
};
