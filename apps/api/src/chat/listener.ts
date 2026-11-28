import { CHAT_EVENTS_CHANNEL, type ChatEvent } from '@dw/db';
import pg from 'pg';
import { z } from 'zod';

const eventSchema = z.strictObject({
  companyId: z.uuid(),
  conversationId: z.uuid(),
  event: z.enum(['message', 'typing']),
  messageId: z.uuid().optional(),
});

export interface ChatListenerLogger {
  readonly warn: (details: object, message: string) => void;
  readonly info: (details: object, message: string) => void;
}

export interface ChatListener {
  /** False once LISTEN has been down for more than `unhealthyAfterMs` (design Risks). */
  readonly healthy: () => boolean;
  readonly close: () => Promise<void>;
}

/**
 * One dedicated connection that LISTENs on `chat_events` (design D3), reconnecting with
 * backoff (1 s → 30 s). Payloads are ids only; anything else is ignored.
 */
export function startChatListener(options: {
  readonly connectionString: string;
  readonly onEvent: (event: ChatEvent) => void;
  readonly logger: ChatListenerLogger;
  readonly unhealthyAfterMs?: number;
  readonly now?: () => number;
}): ChatListener {
  const now = options.now ?? Date.now;
  const unhealthyAfterMs = options.unhealthyAfterMs ?? 30_000;
  let client: pg.Client | null = null;
  let connected = false;
  let downSince: number | null = now();
  let closed = false;
  let delay = 1_000;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (closed) return;
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30_000);
  };

  const lost = (error?: unknown) => {
    if (connected) {
      options.logger.warn(
        { error: error instanceof Error ? error.name : 'closed' },
        'chat listener disconnected',
      );
    }
    connected = false;
    downSince ??= now();
    const old = client;
    client = null;
    void old?.end().catch(() => {});
    schedule();
  };

  async function connect(): Promise<void> {
    if (closed) return;
    const next = new pg.Client({ connectionString: options.connectionString });
    next.on('error', lost);
    next.on('end', () => {
      if (client === next) lost();
    });
    next.on('notification', (message) => {
      if (message.channel !== CHAT_EVENTS_CHANNEL || !message.payload) return;
      try {
        const parsed = eventSchema.safeParse(JSON.parse(message.payload));
        if (parsed.success) options.onEvent(parsed.data);
      } catch {
        // Not JSON: not ours.
      }
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${CHAT_EVENTS_CHANNEL}`);
      if (closed) {
        await next.end();
        return;
      }
      client = next;
      connected = true;
      downSince = null;
      delay = 1_000;
      options.logger.info({}, 'chat listener connected');
    } catch (error) {
      await next.end().catch(() => {});
      lost(error);
    }
  }

  void connect();

  return {
    healthy: () => connected || (downSince !== null && now() - downSince <= unhealthyAfterMs),
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      const old = client;
      client = null;
      connected = false;
      await old?.end().catch(() => {});
    },
  };
}
