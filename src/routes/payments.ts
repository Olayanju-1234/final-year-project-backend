import { Router, Request, Response, NextFunction } from 'express';
import { auth } from '@/middleware/auth';
import { rateLimiter } from '@/middleware/rateLimiter';
import { startConnectOnboarding, getConnectStatus } from '@/controllers/connectController';
import {
  createViewingDepositSession,
  createPaystackDepositSession,
  verifyPaystackPayment,
  getViewingDepositStatus,
  requestRefund,
  getPaymentHistory,
  getActivityLog,
  createSubscriptionCheckout,
  createBillingPortalSession,
  handleStripeWebhook,
  handlePaystackWebhook,
} from '@/controllers/paymentController';

export const paymentRoutes = Router();

/**
 * Webhook routes — must receive the raw body for signature verification.
 * Registered before any body-parser middleware in server.ts.
 */
const rawBodyCollector = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
};

/** Stripe webhook — no auth, raw body required */
paymentRoutes.post('/webhook', rawBodyCollector, handleStripeWebhook);

/** Paystack webhook — no auth, raw body required */
paymentRoutes.post('/webhook/paystack', rawBodyCollector, handlePaystackWebhook);

/** Create a Stripe viewing deposit Checkout Session */
paymentRoutes.post(
  '/viewing/:viewingId/deposit',
  auth,
  rateLimiter.payment,
  createViewingDepositSession,
);

/** Initialize a Paystack inline deposit */
paymentRoutes.post(
  '/viewing/:viewingId/deposit/paystack',
  auth,
  rateLimiter.payment,
  createPaystackDepositSession,
);

/** Verify a Paystack payment after inline popup callback */
paymentRoutes.post(
  '/viewing/:viewingId/deposit/paystack/verify',
  auth,
  verifyPaystackPayment,
);

/** Get the deposit payment status for a viewing */
paymentRoutes.get(
  '/viewing/:viewingId/deposit',
  auth,
  getViewingDepositStatus,
);

/** Tenant-initiated refund request */
paymentRoutes.post(
  '/viewing/:viewingId/refund',
  auth,
  rateLimiter.payment,
  requestRefund,
);

/** Payment history for the authenticated user */
paymentRoutes.get('/history', auth, getPaymentHistory);

/** Activity/audit log for the authenticated user */
paymentRoutes.get('/activity', auth, getActivityLog);

/** Stripe Connect — start Express account onboarding for landlord payouts */
paymentRoutes.post('/connect/onboard', auth, startConnectOnboarding);

/** Stripe Connect — check onboarding status of landlord's connected account */
paymentRoutes.get('/connect/status', auth, getConnectStatus);

/** Create Stripe Checkout Session for a subscription plan (Pro / Enterprise) */
paymentRoutes.post('/subscription/checkout', auth, createSubscriptionCheckout);

/** Create Stripe Billing Portal session for an existing subscriber */
paymentRoutes.post('/billing-portal', auth, createBillingPortalSession);
