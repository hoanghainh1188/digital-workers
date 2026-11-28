import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startChatListener } from '../src/chat/listener.ts';
import {
  auditEventsOf,
  type Harness,
  makeApp,
  startHarness,
  type TestApp,
  WEB_ORIGIN,
} from './support/harness.ts';
import { call, seedOrg, sqlIn } from './support/org.ts';
import { giveCredit } from './support/platform.ts';
import { addAccounting, type WorkerTenant, workerIn } from './support/workers.ts';

type App = TestApp & { queue: { starts: unknown[]; runs: unknown[] } };

describe('web chat API (task group 7, spec web-chat)', () => {
  let harness: Harness;
  let t: App;
  let a: WorkerTenant;
  let b: WorkerTenant;

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness, { chatSendLimit: { max: 20, windowMs: 60_000 }, chatRecheckMs: 300 });
    a = await addAccounting(t, harness, await seedOrg(t, harness, 'Gốm An Phú'));
    b = await addAccounting(t, harness, await seedOrg(t, harness, 'Công ty B'));
    await giveCredit(harness, a.companyId, 500_000);
    await giveCredit(harness, b.companyId, 500_000);
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  const open = (cookie: string, workerId: string, fresh = false) =>
    call(t.app, 'POST', `/api/chat/workers/${workerId}/conversations`, cookie, { fresh });
  const send = (
    cookie: string,
    conversationId: string,
    text: string,
    clientMessageId: string = randomUUID(),
  ) =>
    call(t.app, 'POST', `/api/chat/conversations/${conversationId}/messages`, cookie, {
      text,
      clientMessageId,
    });
  const taskCount = async (companyId: string) =>
    Number((await sqlIn(harness, companyId, 'select count(*)::int as n from tasks'))[0]?.n);

  async function probationWorker(testers: string[]) {
    const id = await workerIn(t, a, 'probation');
    const res = await call(t.app, 'PUT', `/api/workers/${id}/testers`, a.owner.cookie, {
      memberIds: testers,
    });
    if (res.statusCode !== 200) throw new Error(`testers: ${res.statusCode} ${res.body}`);
    return id;
  }

  describe('who may chat (7.1)', () => {
    it('a tester chats with a probation worker; a Task is created', async () => {
      const workerId = await probationWorker([a.member.memberId]);
      const conversation = await open(a.member.cookie, workerId);
      expect(conversation.statusCode).toBe(200);
      const res = await send(a.member.cookie, conversation.json().id, 'Báo giá 100 bát');
      expect(res.statusCode).toBe(201);
      expect(res.json().message).toMatchObject({ role: 'user', content: 'Báo giá 100 bát' });
      expect(res.json().message.taskId).toBeTruthy();
    });

    it('a colleague not on the list → 403 + access.denied; the Owner too (#121)', async () => {
      const workerId = await probationWorker([a.member.memberId]);
      const colleague = await open(a.manager.cookie, workerId);
      expect(colleague.statusCode).toBe(403);
      expect(colleague.json().error.code).toBe('NOT_A_TESTER');
      const owner = await open(a.owner.cookie, workerId);
      expect(owner.statusCode).toBe(403);
      expect(owner.json().error.code).toBe('NOT_A_TESTER');
      const audit = await auditEventsOf(harness, a.companyId);
      expect(
        audit.filter((e) => e.action === 'access.denied' && e.target_id === workerId),
      ).toHaveLength(2);
    });

    it('active worker: Manager of its department yes, of another no; Member only when assigned', async () => {
      const workerId = await workerIn(t, a, 'active');
      expect((await open(a.manager.cookie, workerId)).statusCode).toBe(200);
      expect((await open(a.accountingManager.cookie, workerId)).statusCode).toBe(403);
      expect((await open(a.member.cookie, workerId)).statusCode).toBe(403);
      await sqlIn(
        harness,
        a.companyId,
        'insert into worker_testers (company_id, worker_id, member_id) values ($1, $2, $3)',
        [a.companyId, workerId, a.member.memberId],
      );
      expect((await open(a.member.cookie, workerId)).statusCode).toBe(200);
    });

    it('a draft worker has no chat: 403 WORKER_NOT_STARTED, no Task', async () => {
      const workerId = await workerIn(t, a, 'draft');
      const before = await taskCount(a.companyId);
      const res = await open(a.manager.cookie, workerId);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('WORKER_NOT_STARTED');
      expect(await taskCount(a.companyId)).toBe(before);
    });

    it("company B's worker or conversation is 404 for company A, with an audit in A", async () => {
      const workerB = await workerIn(t, b, 'active');
      const res = await open(a.owner.cookie, workerB);
      expect(res.statusCode).toBe(404);
      const audit = await auditEventsOf(harness, a.companyId);
      expect(audit.some((e) => e.action === 'access.not_found' && e.target_id === workerB)).toBe(
        true,
      );
      const convB = (await open(b.owner.cookie, workerB)).json().id as string;
      expect(
        (await call(t.app, 'GET', `/api/chat/conversations/${convB}/messages`, a.owner.cookie))
          .statusCode,
      ).toBe(404);
      expect((await send(a.owner.cookie, convB, 'x')).statusCode).toBe(404);
    });

    it("the Owner cannot read a Member's conversation (#127): 404 + audit", async () => {
      const workerId = await probationWorker([a.member.memberId, a.owner.memberId]);
      const conv = (await open(a.member.cookie, workerId)).json().id as string;
      await send(a.member.cookie, conv, 'Riêng tư');
      const res = await call(
        t.app,
        'GET',
        `/api/chat/conversations/${conv}/messages`,
        a.owner.cookie,
      );
      expect(res.statusCode).toBe(404);
      const audit = await auditEventsOf(harness, a.companyId);
      expect(audit.some((e) => e.action === 'access.not_found' && e.target_id === conv)).toBe(true);
    });

    it('lists the workers the caller may chat with, and only those', async () => {
      const mine = await probationWorker([a.member.memberId]);
      const notMine = await probationWorker([a.manager.memberId]);
      const res = await call(t.app, 'GET', '/api/chat/workers', a.member.cookie);
      const ids = (res.json().workers as Array<{ id: string }>).map((w) => w.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(notMine);
    });

    it('a new conversation leaves the old one behind', async () => {
      const workerId = await probationWorker([a.member.memberId]);
      const first = (await open(a.member.cookie, workerId)).json().id as string;
      await send(a.member.cookie, first, 'Cũ');
      const fresh = await open(a.member.cookie, workerId, true);
      expect(fresh.statusCode).toBe(201);
      expect(fresh.json().id).not.toBe(first);
      expect(
        (
          await call(
            t.app,
            'GET',
            `/api/chat/conversations/${fresh.json().id}/messages`,
            a.member.cookie,
          )
        ).json().messages,
      ).toEqual([]);
      expect((await send(a.member.cookie, first, 'Vào cuộc cũ')).statusCode).toBe(409);
      expect((await open(a.member.cookie, workerId)).json().id).toBe(fresh.json().id);
    });
  });

  describe('sending (7.2)', () => {
    it('suspended worker / no credit → fixed notice, no Task, no CostEntry', async () => {
      const suspended = await workerIn(t, a, 'suspended');
      const conv = (await open(a.manager.cookie, suspended)).json().id as string;
      const before = await taskCount(a.companyId);
      const res = await send(a.manager.cookie, conv, 'Báo giá');
      expect(res.statusCode).toBe(201);
      expect(res.json().message.taskId).toBeNull();
      expect(res.json().notice).toMatchObject({ role: 'notice' });
      expect(res.json().notice.content).toMatch(/đang tạm nghỉ, chưa nhận việc mới\.$/);
      expect(await taskCount(a.companyId)).toBe(before);

      const poor = await addAccounting(t, harness, await seedOrg(t, harness, 'Công ty hết tiền'));
      const workerId = await workerIn(t, poor, 'active');
      const pconv = (await open(poor.owner.cookie, workerId)).json().id as string;
      const broke = await send(poor.owner.cookie, pconv, 'Báo giá');
      expect(broke.json().notice.content).toBe(
        'Công ty đã hết credit. Vui lòng báo Owner nạp thêm.',
      );
      const costs = await sqlIn(
        harness,
        poor.companyId,
        'select count(*)::int as n from cost_entries',
      );
      expect(costs[0]?.n).toBe(0);
    });

    it('4.001 characters → 400; empty → 400; no clientMessageId → 400; nothing stored', async () => {
      const workerId = await probationWorker([a.member.memberId]);
      const conv = (await open(a.member.cookie, workerId)).json().id as string;
      expect((await send(a.member.cookie, conv, 'x'.repeat(4001))).statusCode).toBe(400);
      expect((await send(a.member.cookie, conv, '   ')).statusCode).toBe(400);
      const missing = await call(
        t.app,
        'POST',
        `/api/chat/conversations/${conv}/messages`,
        a.member.cookie,
        { text: 'Chào' },
      );
      expect(missing.statusCode).toBe(400);
      expect((await send(a.member.cookie, conv, 'x'.repeat(4000))).statusCode).toBe(201);
      const stored = await sqlIn(
        harness,
        a.companyId,
        'select count(*)::int as n from task_messages where conversation_id = $1',
        [conv],
      );
      expect(stored[0]?.n).toBe(1);
    });

    it('resending the same clientMessageId → 200 with the stored message, one Task, one job', async () => {
      const workerId = await probationWorker([a.member.memberId]);
      const conv = (await open(a.member.cookie, workerId)).json().id as string;
      const id = randomUUID();
      const startsBefore = t.queue.starts.length;
      const first = await send(a.member.cookie, conv, 'Báo giá', id);
      const again = await send(a.member.cookie, conv, 'Báo giá', id);
      expect(first.statusCode).toBe(201);
      expect(again.statusCode).toBe(200);
      expect(again.json().message.id).toBe(first.json().message.id);
      const messages = await sqlIn(
        harness,
        a.companyId,
        'select count(*)::int as n from task_messages where conversation_id = $1',
        [conv],
      );
      const tasks = await sqlIn(
        harness,
        a.companyId,
        'select count(*)::int as n from tasks where conversation_id = $1',
        [conv],
      );
      expect(messages[0]?.n).toBe(1);
      expect(tasks[0]?.n).toBe(1);
      expect(t.queue.starts.length - startsBefore).toBe(1);

      const suspended = await workerIn(t, a, 'suspended');
      const sconv = (await open(a.manager.cookie, suspended)).json().id as string;
      const sid = randomUUID();
      await send(a.manager.cookie, sconv, 'Một', sid);
      await send(a.manager.cookie, sconv, 'Một', sid);
      const rows = await sqlIn(
        harness,
        a.companyId,
        'select role from task_messages where conversation_id = $1 order by seq',
        [sconv],
      );
      expect(rows.map((r) => r.role)).toEqual(['user', 'notice']);
    });

    it('the 21st message in a minute → 429 and is not stored', async () => {
      const limited = makeApp(harness, { chatSendLimit: { max: 20, windowMs: 60_000 } });
      const workerId = await probationWorker([a.member.memberId]);
      const conv = (await open(a.member.cookie, workerId)).json().id as string;
      for (let i = 0; i < 20; i += 1) {
        const res = await call(
          limited.app,
          'POST',
          `/api/chat/conversations/${conv}/messages`,
          a.member.cookie,
          { text: `Tin ${i}`, clientMessageId: randomUUID() },
        );
        expect(res.statusCode).toBe(201);
      }
      const over = await call(
        limited.app,
        'POST',
        `/api/chat/conversations/${conv}/messages`,
        a.member.cookie,
        { text: 'Tin 21', clientMessageId: randomUUID() },
      );
      expect(over.statusCode).toBe(429);
      const stored = await sqlIn(
        harness,
        a.companyId,
        'select count(*)::int as n from task_messages where conversation_id = $1',
        [conv],
      );
      expect(stored[0]?.n).toBe(20);
      await limited.app.close();
    });
  });

  describe('real time (7.3, 7.4)', () => {
    let wsUrl = '';
    beforeAll(async () => {
      const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
      wsUrl = `${address.replace('http', 'ws')}/api/chat/ws`;
    });

    it('NOTIFY reaches the subscribed socket; a socket cannot subscribe to another person', async () => {
      const listener = startChatListener({
        connectionString: harness.pg.appUrl,
        onEvent: (event) => t.platform.chat.hub.dispatch(event),
        logger: { info: () => {}, warn: () => {} },
      });
      try {
        for (let i = 0; i < 50 && !listener.healthy(); i += 1)
          await new Promise((r) => setTimeout(r, 50));
        const workerId = await probationWorker([a.member.memberId, a.manager.memberId]);
        const mine = (await open(a.member.cookie, workerId)).json().id as string;
        const theirs = (await open(a.manager.cookie, workerId)).json().id as string;
        const client = await connect(wsUrl, { cookie: a.member.cookie, origin: WEB_ORIGIN });
        const { frames } = client;
        const ws = client.socket;
        ws.send(JSON.stringify({ type: 'subscribe', conversationId: theirs }));
        ws.send(JSON.stringify({ type: 'subscribe', conversationId: mine }));
        await waitFor(() => frames.length >= 2);
        expect(frames.slice(0, 2)).toEqual([
          { type: 'error', code: 'NOT_FOUND' },
          { type: 'subscribed', conversationId: mine },
        ]);
        await send(a.member.cookie, mine, 'Xin chào');
        await send(a.manager.cookie, theirs, 'Của người khác');
        await waitFor(() => frames.some((f) => f.type === 'message'));
        await new Promise((r) => setTimeout(r, 200));
        const contents = frames.filter((f) => f.type === 'message').map((f) => f.message?.content);
        expect(contents).toEqual(['Xin chào']);
        ws.close();
      } finally {
        await listener.close();
      }
    });

    it('rejects a foreign Origin and a missing session', async () => {
      await expect(
        connect(wsUrl, { cookie: a.member.cookie, origin: 'https://evil.example' }),
      ).rejects.toThrow();
      await expect(connect(wsUrl, { origin: WEB_ORIGIN })).rejects.toThrow();
    });

    it('a member locked while connected is disconnected within the re-check interval', async () => {
      const person = a.accountingMember;
      const { closed } = await connect(wsUrl, { cookie: person.cookie, origin: WEB_ORIGIN });
      await sqlIn(
        harness,
        a.companyId,
        "update members set status = 'locked', locked_at = now() where id = $1",
        [person.memberId],
      );
      const code = await Promise.race([
        closed,
        new Promise<number>((r) => setTimeout(() => r(-1), 3_000)),
      ]);
      expect(code).toBe(4401);
    });

    it('at most 5 sockets per member', async () => {
      const sockets: Client[] = [];
      for (let i = 0; i < 5; i += 1) {
        sockets.push(await connect(wsUrl, { cookie: a.admin.cookie, origin: WEB_ORIGIN }));
      }
      await expect(
        connect(wsUrl, { cookie: a.admin.cookie, origin: WEB_ORIGIN }),
      ).rejects.toThrow();
      for (const client of sockets) client.socket.close();
    });
  });
});

type Frame = {
  type: string;
  code?: string;
  conversationId?: string;
  message?: { content: string };
};
type Client = { socket: WebSocket; frames: Frame[]; closed: Promise<number> };

/**
 * A real WebSocket client (Node's built-in): `injectWS` of @fastify/websocket 11.3.7 sends
 * Sec-WebSocket-Version as a number, which ws 8 refuses (400), so tests use a listening server.
 */
function connect(url: string, headers: Record<string, string>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers } as unknown as string[]);
    const frames: Frame[] = [];
    let opened = false;
    const closed = new Promise<number>((done) =>
      socket.addEventListener('close', (event) => done(event.code)),
    );
    socket.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))));
    socket.addEventListener('open', () => {
      opened = true;
      resolve({ socket, frames, closed });
    });
    socket.addEventListener('error', () => {
      if (!opened) reject(new Error('refused'));
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
