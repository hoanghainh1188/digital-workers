import nodemailer from 'nodemailer';
import type { RenderedEmail } from './templates/vi.ts';

export type OutgoingEmail = RenderedEmail & { readonly to: string };
export type SentEmail = OutgoingEmail & { readonly from: string };

export type Mailer = {
  readonly send: (email: OutgoingEmail) => Promise<void>;
  readonly close: () => void;
};

/** SMTP mailer (dev: Mailpit; prod: provider chosen in deploy-staging, 0.2 #042). */
export function createMailer(options: { smtpUrl: string; from: string }): Mailer {
  const transport = nodemailer.createTransport(options.smtpUrl);
  return Object.freeze({
    send: async (email: OutgoingEmail) => {
      await transport.sendMail({ from: options.from, ...email });
    },
    close: () => transport.close(),
  });
}

/** Keeps sent emails in memory, for tests. */
export function createMemoryMailer(from = 'test@digital-workers.local') {
  const sent: SentEmail[] = [];
  const mailer: Mailer = Object.freeze({
    send: async (email: OutgoingEmail) => {
      sent.push(Object.freeze({ from, ...email }));
    },
    close: () => {},
  });
  return { mailer, sent: sent as readonly SentEmail[] };
}
