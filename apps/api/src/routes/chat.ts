import { type IntakeWorker, readIntake, receiveMessage } from '@dw/channels';
import {
  type ChatAccess,
  type CoalesceWindow,
  canChatWith,
  DEFAULT_COALESCE_WINDOW,
} from '@dw/core';
import {
  type ConversationRow,
  conversationById,
  type Database,
  listMessages,
  members,
  openConversation,
  startNewConversation,
  withCompany,
  workers,
  workerTesters,
} from '@dw/db';
import { and, asc, eq, inArray, ne } from '@dw/db/drizzle';
import type { TaskQueue } from '@dw/db/queue';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { messageView } from '../chat/hub.ts';
import { perKeyLimit, type RequestLimit } from '../plugins/request-guards.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import { type AuditWriter, companyContext, type Guards, sendError } from '../tenancy/index.ts';

export type ChatRouteDeps = {
  readonly database: Database;
  readonly guards: Guards;
  readonly audit: AuditWriter;
  readonly chat: {
    readonly queue: TaskQueue;
    /** Per member (0.2 #133): 20 per minute. */
    readonly sendLimit: RequestLimit;
    readonly window?: CoalesceWindow;
    readonly onBudgetExhausted?: (companyId: string, worker: IntakeWorker) => Promise<void>;
    readonly onQueueError?: (error: unknown) => void;
  };
};

/** Text of one message (0.2 #133). */
export const MAX_MESSAGE_LENGTH = 4000;

const idParams = z.object({ id: z.string() });
const workerParams = z.object({ workerId: z.string() });
const message = z.strictObject({
  id: z.uuid(),
  /** Order within the conversation: sort by this, not by createdAt. */
  seq: z.number().int(),
  role: z.enum(['user', 'worker', 'notice']),
  content: z.string(),
  createdAt: z.string(),
  taskId: z.uuid().nullable(),
});
const conversation = z.strictObject({
  id: z.uuid(),
  workerId: z.uuid(),
  status: z.enum(['open', 'closed']),
  createdAt: z.string(),
});
const sendBody = z.strictObject({
  text: z
    .string()
    .refine((value) => value.trim().length > 0, { message: 'required' })
    .pipe(z.string().max(MAX_MESSAGE_LENGTH)),
  clientMessageId: z.uuid(),
});

/** 403 codes of a refused chat (spec web-chat). */
const REFUSAL: Readonly<Record<Exclude<ChatAccess, 'ok'>, { code: string; message: string }>> = {
  draft: { code: 'WORKER_NOT_STARTED', message: 'Worker has not started probation' },
  not_tester: { code: 'NOT_A_TESTER', message: 'Only testers may chat with a probation worker' },
  forbidden: { code: 'FORBIDDEN', message: 'Not allowed' },
};

const conversationView = (row: ConversationRow) => ({
  id: row.id,
  workerId: row.workerId,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Web chat API (spec web-chat, design D3, D7). Who may chat with which worker is decided
 * in code (`canChatWith`) on every call; a conversation belongs to one member and is 404
 * for everybody else, Owner included (0.2 #127, #141).
 */
export function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { guards, database } = deps;
  const isUuid = (id: string) => z.uuid().safeParse(id).success;
  const sendLimit = perKeyLimit(deps.chat.sendLimit, (request) => {
    return request.ctx?.member?.memberId ?? request.ip;
  });

  async function refuse(
    request: FastifyRequest,
    reply: FastifyReply,
    access: Exclude<ChatAccess, 'ok'>,
    workerId: string,
  ) {
    const { member } = companyContext(request);
    await deps.audit(member.companyId, {
      actorMemberId: member.memberId,
      action: 'access.denied',
      targetType: 'worker',
      targetId: workerId,
    });
    const refusal = REFUSAL[access];
    return sendError(reply, 403, refusal.code, refusal.message);
  }

  /** The caller's own conversation, or 404 + `access.not_found` (another person's, company). */
  async function ownConversation(request: FastifyRequest, reply: FastifyReply, id: string) {
    const { member } = companyContext(request);
    const row = isUuid(id)
      ? await withCompany(database, member.companyId, (tx) => conversationById(tx, id))
      : null;
    if (!row || row.memberId !== member.memberId) {
      await guards.notFound(request, reply, 'chat_conversation', id);
      return null;
    }
    return row;
  }

  routes.get(
    '/api/chat/workers',
    {
      preHandler: guards.requireCompany,
      schema: {
        response: {
          200: z.strictObject({
            workers: z.array(
              z.strictObject({
                id: z.uuid(),
                name: z.string(),
                status: z.enum(['probation', 'active', 'suspended']),
                departmentId: z.uuid(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const { member } = companyContext(request);
      const list = await withCompany(database, member.companyId, async (tx) => {
        const [me] = await tx
          .select({ role: members.role, departmentId: members.departmentId })
          .from(members)
          .where(eq(members.id, member.memberId));
        if (!me) return [];
        const rows = await tx
          .select({
            id: workers.id,
            name: workers.name,
            status: workers.status,
            departmentId: workers.departmentId,
          })
          .from(workers)
          .where(and(ne(workers.status, 'draft'), ne(workers.status, 'offboarded')))
          .orderBy(asc(workers.name));
        const testers = rows.length
          ? await tx
              .select({ workerId: workerTesters.workerId, memberId: workerTesters.memberId })
              .from(workerTesters)
              .where(
                inArray(
                  workerTesters.workerId,
                  rows.map((row) => row.id),
                ),
              )
          : [];
        return rows.filter(
          (row) =>
            canChatWith(
              { memberId: member.memberId, role: me.role, departmentId: me.departmentId },
              row,
              testers.filter((t) => t.workerId === row.id).map((t) => t.memberId),
            ) === 'ok',
        );
      });
      return {
        workers: list.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status as 'probation' | 'active' | 'suspended',
          departmentId: row.departmentId,
        })),
      };
    },
  );

  // Opens the member's conversation with the worker; `fresh: true` = "Cuộc trò chuyện mới".
  routes.post(
    '/api/chat/workers/:workerId/conversations',
    {
      preHandler: guards.requireCompany,
      schema: {
        params: workerParams,
        body: z.strictObject({ fresh: z.boolean().default(false) }).default({ fresh: false }),
        response: { 200: conversation, 201: conversation },
      },
    },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { workerId } = request.params;
      if (!isUuid(workerId)) return guards.notFound(request, reply, 'worker', workerId);
      const outcome = await withCompany(database, member.companyId, async (tx) => {
        const state = await readIntake(tx, { workerId, memberId: member.memberId });
        if (!state) return { kind: 'missing' } as const;
        if (state.access !== 'ok') return { kind: 'refused', access: state.access } as const;
        const row = request.body.fresh
          ? await startNewConversation(tx, member.companyId, workerId, member.memberId)
          : await openConversation(tx, member.companyId, workerId, member.memberId);
        return { kind: 'ok', row, created: request.body.fresh } as const;
      });
      if (outcome.kind === 'missing') return guards.notFound(request, reply, 'worker', workerId);
      if (outcome.kind === 'refused') return refuse(request, reply, outcome.access, workerId);
      return reply.status(outcome.created ? 201 : 200).send(conversationView(outcome.row));
    },
  );

  routes.get(
    '/api/chat/conversations/:id/messages',
    {
      preHandler: guards.requireCompany,
      schema: {
        params: idParams,
        querystring: z.object({
          after: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: { 200: z.strictObject({ messages: z.array(message) }) },
      },
    },
    async (request, reply) => {
      const row = await ownConversation(request, reply, request.params.id);
      if (!row) return reply;
      const { member } = companyContext(request);
      const list = await withCompany(database, member.companyId, (tx) =>
        listMessages(tx, row.id, {
          afterId: request.query.after ?? null,
          limit: request.query.limit,
        }),
      );
      return { messages: list.map(messageView) };
    },
  );

  routes.post(
    '/api/chat/conversations/:id/messages',
    {
      preHandler: [guards.requireCompany, sendLimit],
      schema: {
        params: idParams,
        body: sendBody,
        response: {
          200: z.strictObject({ message, notice: message.nullable() }),
          201: z.strictObject({ message, notice: message.nullable() }),
        },
      },
    },
    async (request, reply) => {
      const row = await ownConversation(request, reply, request.params.id);
      if (!row) return reply;
      if (row.status !== 'open') {
        return sendError(reply, 409, 'CONVERSATION_CLOSED', 'Start a new conversation');
      }
      const { member } = companyContext(request);
      const result = await receiveMessage(
        {
          database,
          queue: deps.chat.queue,
          window: deps.chat.window ?? DEFAULT_COALESCE_WINDOW,
          onBudgetExhausted: deps.chat.onBudgetExhausted,
          onQueueError: deps.chat.onQueueError,
        },
        {
          companyId: member.companyId,
          workerId: row.workerId,
          memberId: member.memberId,
          conversationId: row.id,
          text: request.body.text,
          clientMessageId: request.body.clientMessageId,
          source: 'web',
        },
      );
      if (result.kind === 'closed') {
        return sendError(reply, 409, 'CONVERSATION_CLOSED', 'Start a new conversation');
      }
      if (result.kind === 'refused') return refuse(request, reply, result.access, row.workerId);
      return reply.status(result.created ? 201 : 200).send({
        message: messageView(result.message),
        notice: result.notice ? messageView(result.notice) : null,
      });
    },
  );
}
