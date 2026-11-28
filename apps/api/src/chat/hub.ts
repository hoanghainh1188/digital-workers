import type { ChatEvent, ChatMessage } from '@dw/db';

/** What the server pushes to a subscribed socket (design D3). */
export type ServerFrame =
  | { readonly type: 'subscribed'; readonly conversationId: string }
  | { readonly type: 'message'; readonly conversationId: string; readonly message: MessageView }
  | { readonly type: 'typing'; readonly conversationId: string }
  | { readonly type: 'error'; readonly code: string };

export interface MessageView {
  readonly id: string;
  /** Order within the conversation (commit order). Clients sort by this. */
  readonly seq: number;
  readonly role: ChatMessage['role'];
  readonly content: string;
  readonly createdAt: string;
  readonly taskId: string | null;
}

export function messageView(message: ChatMessage): MessageView {
  return {
    id: message.id,
    seq: message.seq,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    taskId: message.taskId,
  };
}

export interface Subscriber {
  readonly memberId: string;
  readonly companyId: string;
  readonly send: (frame: ServerFrame) => void;
}

/**
 * Who follows which conversation in this api process. A socket is added only after its
 * subscription passed the permission check (routes/chat.ts).
 */
export function createChatHub(deps: {
  readonly readMessage: (companyId: string, messageId: string) => Promise<ChatMessage | null>;
  readonly onError: (error: unknown) => void;
}) {
  const byConversation = new Map<string, Set<Subscriber>>();
  // One chain per conversation: frames go out in NOTIFY order (= commit order).
  const chains = new Map<string, Promise<void>>();

  return {
    add(conversationId: string, subscriber: Subscriber): void {
      const set = byConversation.get(conversationId) ?? new Set<Subscriber>();
      set.add(subscriber);
      byConversation.set(conversationId, set);
    },
    removeAll(subscriber: Subscriber): void {
      for (const [conversationId, set] of byConversation) {
        set.delete(subscriber);
        if (set.size === 0) byConversation.delete(conversationId);
      }
    },
    subscribers(conversationId: string): number {
      return byConversation.get(conversationId)?.size ?? 0;
    },
    /** Called for every NOTIFY: reads the message inside its company and fans it out. */
    dispatch(event: ChatEvent): void {
      const set = byConversation.get(event.conversationId);
      if (!set || set.size === 0) return;
      const targets = [...set].filter((sub) => sub.companyId === event.companyId);
      const previous = chains.get(event.conversationId) ?? Promise.resolve();
      const next = previous
        .then(async () => {
          if (event.event === 'typing') {
            for (const sub of targets)
              sub.send({ type: 'typing', conversationId: event.conversationId });
            return;
          }
          if (!event.messageId) return;
          const message = await deps.readMessage(event.companyId, event.messageId);
          if (!message) return;
          const frame: ServerFrame = {
            type: 'message',
            conversationId: event.conversationId,
            message: messageView(message),
          };
          for (const sub of targets) sub.send(frame);
        })
        .catch(deps.onError);
      chains.set(event.conversationId, next);
      void next.then(() => {
        if (chains.get(event.conversationId) === next) chains.delete(event.conversationId);
      });
    },
  };
}

export type ChatHub = ReturnType<typeof createChatHub>;
