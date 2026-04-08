import https from 'https';
import crypto from 'crypto';
import { logger } from '@/utils/logger';

// Paystack deposit amount in kobo (₦5,000 = 500000 kobo)
const DEPOSIT_AMOUNT_KOBO = 500000;
const DEPOSIT_AMOUNT_NGN = 5000;

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: 'success' | 'failed' | 'abandoned';
    reference: string;
    amount: number; // in kobo
    currency: string;
    paid_at: string;
    channel: string;
  };
}

/**
 * Make a server-side Paystack API request.
 * Uses Node https module — no third-party SDK, no extra dependencies.
 */
function paystackRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, any>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return reject(new Error('PAYSTACK_SECRET_KEY is not configured'));
    }

    const bodyStr = body ? JSON.stringify(body) : '';
    const options: https.RequestOptions = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) }),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch {
          reject(new Error(`Paystack response parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export const PaystackService = {
  DEPOSIT_AMOUNT_NGN,

  /**
   * Initialize a Paystack transaction for a viewing deposit.
   * Returns reference + public_key for the frontend inline popup.
   */
  async initializeDeposit(params: {
    email: string;
    viewingId: string;
    tenantId: string;
    propertyTitle: string;
    callbackUrl: string;
  }): Promise<{ reference: string; amount: number; email: string; public_key: string }> {
    const publicKey = process.env.PAYSTACK_PUBLIC_KEY;
    if (!publicKey) throw new Error('PAYSTACK_PUBLIC_KEY is not configured');

    // Stable reference for idempotency — same viewingId always gives the same reference
    const reference = `rm_deposit_${params.viewingId}`;

    const response = await paystackRequest<PaystackInitResponse>('POST', '/transaction/initialize', {
      email: params.email,
      amount: DEPOSIT_AMOUNT_KOBO,
      currency: 'NGN',
      reference,
      callback_url: params.callbackUrl,
      metadata: {
        viewingId: params.viewingId,
        tenantId: params.tenantId,
        propertyTitle: params.propertyTitle,
        type: 'viewing_deposit',
      },
    });

    if (!response.status) {
      throw new Error(`Paystack init failed: ${response.message}`);
    }

    return {
      reference,
      amount: DEPOSIT_AMOUNT_NGN,
      email: params.email,
      public_key: publicKey,
    };
  },

  /**
   * Verify a Paystack transaction by reference.
   * Called after the inline popup callback or webhook.
   */
  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse['data']> {
    const response = await paystackRequest<PaystackVerifyResponse>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );

    if (!response.status) {
      throw new Error(`Paystack verify failed: ${response.message}`);
    }

    return response.data;
  },

  /**
   * Verify a Paystack webhook event signature.
   * Hash the raw body with HMAC-SHA512 using the secret key.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) return false;
    const hash = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
    return hash === signature;
  },
};
