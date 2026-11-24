export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface MailSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/**
 * Transport-agnostic email provider. SMTP ships today; SES/Resend can be
 * added later by implementing this interface without touching callers.
 */
export interface MailProvider {
  send(message: MailMessage): Promise<MailSendResult>;
}
