import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '@/middleware/auth';
import {
  createViewingDepositSession,
  getViewingDepositStatus,
  handleStripeWebhook,
} from '@/controllers/paymentController';

export const paymentRoutes = Router();

/**
 * Stripe webhook — must receive the raw body for signature verification.
 * Collect the raw body before Express parses it as JSON.
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

/** Create a viewing deposit Checkout Session */
paymentRoutes.post(
  '/viewing/:viewingId/deposit',
  authenticate,
  createViewingDepositSession,
);

/** Get the deposit payment status for a viewing */
paymentRoutes.get(
  '/viewing/:viewingId/deposit',
  authenticate,
  getViewingDepositStatus,
);
