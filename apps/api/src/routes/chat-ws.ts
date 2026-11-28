import { readIntake } from '@dw/channels';
import { conversationById, type Database, withCompany } from '@dw/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChatHub, ServerFrame, Subscriber } from '../chat/hub.ts';
import { type ContextResolver, companyContext, type Guards, sendError } from '../tenancy/index.ts';

export type ChatSocketDeps = {
  readonly database: Database;
  readonly guards: Guards;
  readonly resolveContext: ContextResolver;
  readonly trustedOrigins: readonly string[];
  readonly hub: ChatHub;
  /** 0.2 #133. */
  readonly maxSocketsPerMember?: number;
  /** Session / lock re-check (design D7). */
  readonly recheckMs?: number;
};

const clientFrame = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('subscribe'), conversationId: z.string().max(100) }),
  z.strictObject({ type: z.literal('ping') }),
]);

/**
 * Real-time push for web chat: GET /api/chat/ws (design D3, D7). The browser sends its
 * session cookie on upgrade; `Origin` must be ours (cross-site WebSocket hijacking).
 * Messages only flow down; sending stays a REST call.
 */
export function registerChatSocket(app: FastifyInstance, deps: ChatSocketDeps): void {
  const trusted = new Set(deps.trustedOrigins);
  const maxSockets = deps.maxSocketsPerMember ?? 5;
  const recheckMs = deps.recheckMs ?? 60_000;
  const open = new Map<string, number>();

  app.get(
    '/api/chat/ws',
    {
      websocket: true,
      preHandler: [
        async (request, reply) => {
          const origin = request.headers.origin;
          if (!origin || !trusted.has(origin)) {
            return sendError(reply, 403, 'INVALID_ORIGIN', 'Request origin not allowed');
          }
        },
        deps.guards.requireCompany,
        async (request, reply) => {
          const { member } = companyContext(request);
          if ((open.get(member.memberId) ?? 0) >= maxSockets) {
            return sendError(reply, 429, 'TOO_MANY_CONNECTIONS', 'Too many open chats');
          }
        },
      ],
    },
    (socket, request) => {
      const { member } = companyContext(request);
      const headers = { cookie: request.headers.cookie };
      open.set(member.memberId, (open.get(member.memberId) ?? 0) + 1);
      const send = (frame: ServerFrame) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
      };
      const subscriber: Subscriber = {
        memberId: member.memberId,
        companyId: member.companyId,
        send,
      };
      let closed = false;

      const close = (code: number) => {
        if (closed) return;
        closed = true;
        socket.close(code);
      };

      // Every minute: is the session still valid and the member still active? (D7)
      const recheck = setInterval(() => {
        void deps
          .resolveContext(headers)
          .then((ctx) => {
            const still = ctx?.member;
            if (still?.status !== 'active' || still.memberId !== member.memberId) {
              deps.hub.removeAll(subscriber);
              close(4401);
            }
          })
          .catch(() => {
            deps.hub.removeAll(subscriber);
            close(4401);
          });
      }, recheckMs);

      socket.on('message', (raw: Buffer) => {
        let parsed: z.infer<typeof clientFrame> | null = null;
        try {
          const result = clientFrame.safeParse(JSON.parse(raw.toString('utf8')));
          parsed = result.success ? result.data : null;
        } catch {
          parsed = null;
        }
        if (!parsed) return send({ type: 'error', code: 'BAD_FRAME' });
        if (parsed.type === 'ping') return;
        const conversationId = parsed.conversationId;
        void subscribe(conversationId).catch(() => send({ type: 'error', code: 'INTERNAL_ERROR' }));
      });

      /** Same rule as the REST API: own conversation, and still allowed to chat (D7). */
      async function subscribe(conversationId: string): Promise<void> {
        const ok = z.uuid().safeParse(conversationId).success
          ? await withCompany(deps.database, member.companyId, async (tx) => {
              const row = await conversationById(tx, conversationId);
              if (!row || row.memberId !== member.memberId) return false;
              const state = await readIntake(tx, {
                workerId: row.workerId,
                memberId: member.memberId,
              });
              return state?.access === 'ok';
            })
          : false;
        if (!ok) return send({ type: 'error', code: 'NOT_FOUND' });
        deps.hub.add(conversationId, subscriber);
        send({ type: 'subscribed', conversationId });
      }

      socket.on('close', () => {
        closed = true;
        clearInterval(recheck);
        deps.hub.removeAll(subscriber);
        const count = (open.get(member.memberId) ?? 1) - 1;
        if (count <= 0) open.delete(member.memberId);
        else open.set(member.memberId, count);
      });
    },
  );
}
