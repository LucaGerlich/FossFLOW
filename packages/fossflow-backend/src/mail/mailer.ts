import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { SmtpConfig } from '../config/config.js';

export const MAILER = Symbol('MAILER');

export interface Mailer {
  /** Without SMTP, links are only shown to the admin who created them. */
  readonly enabled: boolean;
  sendInvitation(to: string, url: string, inviterName: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
  /** Plain-text alert to several recipients; a no-op without SMTP. */
  sendAlert(to: string[], subject: string, text: string): Promise<void>;
}

const logger = new Logger('Mail');

const SMTP_TIMEOUT_MS = 10_000;

export function createMailer(smtp: SmtpConfig | null): Mailer {
  if (!smtp) {
    return {
      enabled: false,
      sendInvitation: async () => {},
      sendPasswordReset: async () => {},
      sendAlert: async () => {}
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    // nodemailer waits minutes by default; an unreachable server must not pin a delivery.
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS
  });

  const send = async (to: string, subject: string, text: string) => {
    try {
      await transport.sendMail({ from: smtp.from, to, subject, text });
    } catch (error) {
      // Names only: messages can carry addresses or server responses.
      logger.warn(`Could not send mail (${error instanceof Error ? error.name : 'unknown error'})`);
      throw error;
    }
  };

  return {
    enabled: true,
    sendInvitation: (to, url, inviterName) =>
      send(
        to,
        'You have been invited to FossFLOW',
        `${inviterName} invited you to FossFLOW.\n\nSet your name and password here (the link works once and expires in 7 days):\n${url}\n`
      ),
    sendPasswordReset: (to, url) =>
      send(
        to,
        'Reset your FossFLOW password',
        `Choose a new password here (the link expires in 1 hour):\n${url}\n\nIf you didn't ask for this, you can ignore this email.\n`
      ),
    sendAlert: (to, subject, text) => send(to.join(', '), subject, text)
  };
}
