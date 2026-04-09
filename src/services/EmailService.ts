import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '@/utils/logger';

interface ViewingEmailData {
  tenantName: string;
  tenantEmail: string;
  landlordName: string;
  landlordEmail: string;
  propertyTitle: string;
  propertyAddress: string;
  viewingDate: string;
  viewingTime: string;
  status: string;
}

interface MessageEmailData {
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  subject: string;
  preview: string;
}

interface DepositEmailData {
  tenantName: string;
  tenantEmail: string;
  propertyTitle: string;
  amount: number;
  currency: string;
  status: 'paid' | 'refunded';
}

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const FROM = `RentMatch <${process.env.EMAIL_FROM ?? 'noreply@rentmatch.app'}>`;

class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.EMAIL_PORT ?? 587),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    return this.transporter;
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      logger.info(`[EmailService] Email skipped (no credentials): ${subject} → ${to}`);
      return;
    }
    try {
      await this.getTransporter().sendMail({ from: FROM, to, subject, html });
      logger.info(`[EmailService] Sent: ${subject} → ${to}`);
    } catch (err: any) {
      // Non-fatal — log and continue. Email failure should never break the API.
      logger.error(`[EmailService] Failed to send "${subject}" to ${to}: ${err.message}`);
    }
  }

  private base(content: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
          <tr><td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
              <tr><td style="background:#111827;padding:24px 32px">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px">RentMatch</span>
              </td></tr>
              <tr><td style="padding:32px">${content}</td></tr>
              <tr><td style="padding:16px 32px;background:#f9fafb;text-align:center">
                <p style="margin:0;font-size:12px;color:#6b7280">
                  &copy; ${new Date().getFullYear()} RentMatch &middot;
                  <a href="${APP_URL}" style="color:#6b7280">Visit site</a>
                </p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>`;
  }

  /** Notify tenant when their viewing request status changes */
  async sendViewingStatusUpdate(data: ViewingEmailData): Promise<void> {
    const statusLabel: Record<string, string> = {
      confirmed: 'Confirmed',
      cancelled: 'Cancelled',
      completed: 'Completed',
      pending: 'Pending',
    };
    const statusColor: Record<string, string> = {
      confirmed: '#16a34a',
      cancelled: '#dc2626',
      completed: '#2563eb',
      pending: '#d97706',
    };
    const label = statusLabel[data.status] ?? data.status;
    const color = statusColor[data.status] ?? '#374151';

    const content = `
      <h2 style="margin:0 0 8px;font-size:20px;color:#111827">Viewing ${label}</h2>
      <p style="margin:0 0 24px;color:#6b7280">Hi ${data.tenantName}, your viewing request has been updated.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:24px">
        <tr style="background:#f9fafb"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;width:40%">Property</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.propertyTitle}</td></tr>
        <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Address</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.propertyAddress}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Date</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.viewingDate}</td></tr>
        <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Time</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.viewingTime}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Status</td><td style="padding:12px 16px"><span style="background:${color};color:#fff;font-size:12px;font-weight:600;padding:2px 10px;border-radius:9999px">${label}</span></td></tr>
      </table>
      <p style="margin:0 0 16px;color:#6b7280">Landlord: <strong style="color:#111827">${data.landlordName}</strong></p>
      <a href="${APP_URL}/tenant-dashboard" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:6px">View Dashboard</a>`;

    await this.send(data.tenantEmail, `Viewing ${label} — ${data.propertyTitle}`, this.base(content));
  }

  /** Notify landlord when a tenant requests a viewing */
  async sendViewingRequest(data: ViewingEmailData): Promise<void> {
    const content = `
      <h2 style="margin:0 0 8px;font-size:20px;color:#111827">New Viewing Request</h2>
      <p style="margin:0 0 24px;color:#6b7280">Hi ${data.landlordName}, a tenant has requested to view your property.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:24px">
        <tr style="background:#f9fafb"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;width:40%">Property</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.propertyTitle}</td></tr>
        <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Tenant</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.tenantName}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Requested Date</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.viewingDate}</td></tr>
        <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600">Requested Time</td><td style="padding:12px 16px;font-size:14px;color:#111827">${data.viewingTime}</td></tr>
      </table>
      <a href="${APP_URL}/property-manager-dashboard" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:6px">Review Request</a>`;

    await this.send(data.landlordEmail, `New Viewing Request — ${data.propertyTitle}`, this.base(content));
  }

  /** Notify tenant/landlord when a message arrives */
  async sendMessageNotification(data: MessageEmailData): Promise<void> {
    const content = `
      <h2 style="margin:0 0 8px;font-size:20px;color:#111827">New Message</h2>
      <p style="margin:0 0 24px;color:#6b7280">Hi ${data.recipientName}, you have a new message from <strong style="color:#111827">${data.senderName}</strong>.</p>
      <div style="border-left:4px solid #111827;padding:12px 16px;background:#f9fafb;border-radius:0 6px 6px 0;margin-bottom:24px">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#374151">${data.subject}</p>
        <p style="margin:0;font-size:14px;color:#6b7280">${data.preview}</p>
      </div>
      <a href="${APP_URL}/tenant-dashboard?tab=messages" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:6px">Read Message</a>`;

    await this.send(data.recipientEmail, `New message from ${data.senderName}`, this.base(content));
  }

  /** Notify tenant when deposit is paid or refunded */
  async sendDepositNotification(data: DepositEmailData): Promise<void> {
    const formatted = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: data.currency.toUpperCase(),
    }).format(data.amount);

    const isPaid = data.status === 'paid';
    const title = isPaid ? 'Deposit Payment Confirmed' : 'Deposit Refund Processed';
    const body = isPaid
      ? `Your deposit of <strong>${formatted}</strong> for <strong>${data.propertyTitle}</strong> has been successfully received.`
      : `Your deposit of <strong>${formatted}</strong> for <strong>${data.propertyTitle}</strong> has been refunded. Please allow 5-10 business days for it to appear.`;

    const content = `
      <h2 style="margin:0 0 8px;font-size:20px;color:#111827">${title}</h2>
      <p style="margin:0 0 24px;color:#6b7280">Hi ${data.tenantName},</p>
      <p style="margin:0 0 24px;color:#374151">${body}</p>
      <a href="${APP_URL}/tenant-dashboard?tab=payments" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:6px">View Payments</a>`;

    await this.send(data.tenantEmail, title, this.base(content));
  }
}

export const emailService = new EmailService();
