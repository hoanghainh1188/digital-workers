import { and, asc, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { chatConversations, taskMessages } from './schema/tasks.ts';
import type { CompanyTx } from './tenancy.ts';

/**
 * Conversations and messages (change add-worker-runtime-webchat, design D1, D3). Every
 * write into one conversation first takes `lockConversation`, so message `seq` order is
 * commit order and readers using `after=` never skip a message.
 */

export type ConversationRow = typeof chatConversations.$inferSelect;
export type MessageRole = (typeof taskMessages.$inferSelect)['role'];

export interface ChatMessage {
  readonly id: string;
  readonly seq: number;
  readonly taskId: string | null;
  readonly role: MessageRole;
  readonly content: string;
  readonly clientMessageId: string | null;
  readonly createdAt: Date;
}

/** Channel for runner → api events (design D3). Payload ids only, never content. */
export const CHAT_EVENTS_CHANNEL = 'chat_events';

export type ChatEvent = {
  readonly companyId: string;
  readonly conversationId: string;
  readonly event: 'message' | 'typing';
  readonly messageId?: string;
};

const messageColumns = {
  id: taskMessages.id,
  seq: taskMessages.seq,
  taskId: taskMessages.taskId,
  role: taskMessages.role,
  content: taskMessages.content,
  clientMessageId: taskMessages.clientMessageId,
  createdAt: taskMessages.createdAt,
};

/** Serialises every state change of one conversation (design D2) until the transaction ends. */
export async function lockConversation(tx: CompanyTx, conversationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${conversationId}, 7))`);
}

export async function conversationById(
  tx: CompanyTx,
  conversationId: string,
): Promise<ConversationRow | null> {
  const [row] = await tx
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId));
  return row ?? null;
}

/** The member's open conversation with the worker, created when there is none. */
export async function openConversation(
  tx: CompanyTx,
  companyId: string,
  workerId: string,
  memberId: string,
): Promise<ConversationRow> {
  const existing = await findOpen(tx, workerId, memberId);
  if (existing) return existing;
  const [created] = await tx
    .insert(chatConversations)
    .values({ companyId, workerId, memberId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Someone else opened it at the same moment (unique partial index).
  const raced = await findOpen(tx, workerId, memberId);
  if (!raced) throw new Error('open conversation vanished');
  return raced;
}

/** "Cuộc trò chuyện mới" (0.2 #126): closes the open one, starts an empty one. */
export async function startNewConversation(
  tx: CompanyTx,
  companyId: string,
  workerId: string,
  memberId: string,
): Promise<ConversationRow> {
  const current = await findOpen(tx, workerId, memberId);
  if (current) {
    // A message being stored right now holds this lock: it lands before the close.
    await lockConversation(tx, current.id);
    await tx
      .update(chatConversations)
      .set({ status: 'closed', closedAt: sql`now()` })
      .where(and(eq(chatConversations.id, current.id), eq(chatConversations.status, 'open')));
  }
  const [created] = await tx
    .insert(chatConversations)
    .values({ companyId, workerId, memberId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Two "Cuộc trò chuyện mới" at once: the other one won; both get the same new one.
  const raced = await findOpen(tx, workerId, memberId);
  if (!raced) throw new Error('conversation not created');
  return raced;
}

async function findOpen(tx: CompanyTx, workerId: string, memberId: string) {
  const [row] = await tx
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.workerId, workerId),
        eq(chatConversations.memberId, memberId),
        eq(chatConversations.status, 'open'),
      ),
    );
  return row ?? null;
}

export interface NewMessage {
  readonly companyId: string;
  readonly conversationId: string;
  readonly taskId: string | null;
  readonly role: MessageRole;
  readonly content: string;
  readonly clientMessageId?: string | null;
}

/**
 * Inserts a message (the caller holds the conversation lock). With a `clientMessageId`
 * already used in this conversation, returns the stored message and `created: false`
 * (0.2 #135).
 */
export async function insertMessage(
  tx: CompanyTx,
  message: NewMessage,
): Promise<{ readonly message: ChatMessage; readonly created: boolean }> {
  const [row] = await tx
    .insert(taskMessages)
    .values({
      companyId: message.companyId,
      conversationId: message.conversationId,
      taskId: message.taskId,
      role: message.role,
      content: message.content,
      clientMessageId: message.clientMessageId ?? null,
    })
    .onConflictDoNothing({
      target: [taskMessages.companyId, taskMessages.conversationId, taskMessages.clientMessageId],
    })
    .returning(messageColumns);
  if (row) return { message: row, created: true };
  const existing = message.clientMessageId
    ? await messageByClientId(tx, message.conversationId, message.clientMessageId)
    : null;
  if (!existing) throw new Error('message not inserted');
  return { message: existing, created: false };
}

export async function messageByClientId(
  tx: CompanyTx,
  conversationId: string,
  clientMessageId: string,
): Promise<ChatMessage | null> {
  const [row] = await tx
    .select(messageColumns)
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.conversationId, conversationId),
        eq(taskMessages.clientMessageId, clientMessageId),
      ),
    );
  return row ?? null;
}

export async function messageById(tx: CompanyTx, messageId: string): Promise<ChatMessage | null> {
  const [row] = await tx
    .select(messageColumns)
    .from(taskMessages)
    .where(eq(taskMessages.id, messageId));
  return row ?? null;
}

/**
 * Messages of a conversation in order, after the message `afterId` when given (tải bù
 * after reconnecting, design D3). An unknown `afterId` returns from the start.
 */
export async function listMessages(
  tx: CompanyTx,
  conversationId: string,
  options: { readonly afterId?: string | null; readonly limit: number },
): Promise<ChatMessage[]> {
  const after = options.afterId ? await messageById(tx, options.afterId) : null;
  return tx
    .select(messageColumns)
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.conversationId, conversationId),
        after ? gt(taskMessages.seq, after.seq) : undefined,
      ),
    )
    .orderBy(asc(taskMessages.seq))
    .limit(options.limit);
}

/**
 * History given to the model (design D8.3): the `limit` latest user / worker messages of
 * the conversation before `beforeSeq`, oldest first. Notices, and user messages that
 * never became a Task, are left out.
 */
export async function conversationHistory(
  tx: CompanyTx,
  conversationId: string,
  beforeSeq: number,
  limit: number,
): Promise<ChatMessage[]> {
  const rows = await tx
    .select(messageColumns)
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.conversationId, conversationId),
        ne(taskMessages.role, 'notice'),
        // A message the worker did not take as work (it was suspended, out of credit…)
        // was never a request it should act on later.
        sql`(${taskMessages.role} = 'worker' OR ${taskMessages.taskId} IS NOT NULL)`,
        sql`${taskMessages.seq} < ${beforeSeq}`,
      ),
    )
    .orderBy(desc(taskMessages.seq))
    .limit(limit);
  return rows.reverse();
}

/** The user messages that make up a Task, in order. */
export async function taskUserMessages(tx: CompanyTx, taskId: string): Promise<ChatMessage[]> {
  return tx
    .select(messageColumns)
    .from(taskMessages)
    .where(and(eq(taskMessages.taskId, taskId), eq(taskMessages.role, 'user')))
    .orderBy(asc(taskMessages.seq));
}

/**
 * Tells api processes about a change (design D3). Inside the caller's transaction, so it
 * is delivered only after commit. The payload carries ids only.
 */
export async function notifyChat(tx: CompanyTx, event: ChatEvent): Promise<void> {
  await tx.execute(sql`select pg_notify(${CHAT_EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}
