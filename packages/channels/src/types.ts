/**
 * The chat-channel contract (design D10, spec channel-adapter). Web chat (change 5),
 * Telegram (change 6) and Zalo (change 12) implement it; the runtime knows only these
 * types, never a channel's SDK.
 */

export type ChannelKind = 'web' | 'telegram' | 'zalo';

/** A message from any channel, normalised at the API edge (`parseWebhook` per channel). */
export interface IncomingMessage {
  readonly kind: ChannelKind;
  /** From the WorkerChannel / session — never from the message content. */
  readonly companyId: string;
  readonly workerId: string;
  readonly chat: { readonly type: 'direct' | 'group'; readonly externalId: string };
  /** `memberId` is null until the sender's account is linked. */
  readonly sender: { readonly externalId: string; readonly memberId: string | null };
  readonly text: string;
  /** Always true in 1:1 chats; in groups, a mention or a reply to the worker. */
  readonly addressedToWorker: boolean;
  readonly externalMessageId: string;
  readonly receivedAt: Date;
}

export interface ChannelTarget {
  readonly kind: ChannelKind;
  readonly companyId: string;
  readonly workerId: string;
  /** Web: the conversation id. */
  readonly chatExternalId: string;
}

export type OutgoingRole = 'worker' | 'notice';

export interface OutgoingMessage {
  readonly text: string;
  /** A worker answer or a fixed system notice (shown differently, spec web-chat). */
  readonly role: OutgoingRole;
  /** The Task the message answers, when there is one. */
  readonly taskId: string | null;
  readonly replyToExternalId?: string;
}

export interface ChannelCapabilities {
  readonly groups: boolean;
  readonly buttons: boolean;
  readonly files: boolean;
}

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  /** Web 8000, Telegram 4096, Zalo 2000. */
  readonly maxTextLength: number;
  readonly capabilities: ChannelCapabilities;
  /** Sends `message`, split into parts of at most `maxTextLength` (splitText). */
  readonly send: (
    target: ChannelTarget,
    message: OutgoingMessage,
  ) => Promise<{ readonly externalIds: string[] }>;
  /** "Đang làm…" */
  readonly sendTyping: (target: ChannelTarget) => Promise<void>;
}
