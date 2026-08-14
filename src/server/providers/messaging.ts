import "server-only";

/**
 * Email and push delivery.
 *
 * ─── The rule this file exists to enforce ───────────────────────────────────
 * Never record a notification as delivered unless a provider actually accepted
 * it. With no provider configured, rows stay `sentAt: null` — pending, not
 * sent. A dashboard that claims "leave request emailed" when no mail server
 * exists is worse than one that says nothing, because someone will rely on it.
 *
 * `notification_service.deliver()` writes IN_APP rows directly (they are
 * delivered by definition — they live in the database the UI reads). EMAIL and
 * PUSH rows go through these providers.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. HTML is intentionally not modelled yet. */
  body: string;
  replyTo?: string;
}

export interface PushMessage {
  /** Device token or topic, provider-specific. */
  target: string;
  title: string;
  body: string;
  linkUrl?: string;
}

export type DeliveryResult =
  | { status: "sent"; providerMessageId: string | null; sentAt: Date }
  | { status: "unconfigured"; reason: string }
  | { status: "failed"; reason: string };

export interface EmailProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: EmailMessage): Promise<DeliveryResult>;
}

export interface PushProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: PushMessage): Promise<DeliveryResult>;
}

/**
 * Placeholder providers.
 *
 * They return `unconfigured` — a distinct status from `failed`, because the
 * two want different operational responses: `failed` means investigate,
 * `unconfigured` means finish the setup.
 */
const unconfiguredEmail: EmailProvider = {
  name: "unconfigured",
  configured: false,
  async send() {
    return {
      status: "unconfigured",
      reason: "No email provider is configured. Notifications remain pending.",
    };
  },
};

const unconfiguredPush: PushProvider = {
  name: "unconfigured",
  configured: false,
  async send() {
    return {
      status: "unconfigured",
      reason: "No push provider is configured. Notifications remain pending.",
    };
  },
};

/**
 * Register a real provider here — Resend, SES, Postmark, FCM, APNs.
 *
 * A provider must only return `sent` when the upstream service has accepted
 * the message. "Accepted for delivery" is the strongest claim available; it is
 * not proof of inbox arrival, and nothing in this codebase should imply
 * otherwise.
 */
export function resolveEmailProvider(): EmailProvider {
  return unconfiguredEmail;
}

export function resolvePushProvider(): PushProvider {
  return unconfiguredPush;
}

/**
 * Deliver a pending notification row through the right transport.
 * Returns the result so the caller can set `sentAt` only on real success.
 */
export async function deliverExternal(
  channel: "EMAIL" | "PUSH",
  message: EmailMessage | PushMessage,
): Promise<DeliveryResult> {
  if (channel === "EMAIL") {
    return resolveEmailProvider().send(message as EmailMessage);
  }
  return resolvePushProvider().send(message as PushMessage);
}

export function messagingStatus() {
  return {
    email: { name: resolveEmailProvider().name, configured: resolveEmailProvider().configured },
    push: { name: resolvePushProvider().name, configured: resolvePushProvider().configured },
  };
}
