import {
  CHAT_EVENTS_CHANNEL,
  createDatabase,
  type Database,
  listMessages,
  openConversation,
  withCompany,
} from '@dw/db';
import { startTestPostgres, type TestPostgres } from '@dw/db/testing';
import { addWorker, seedTenant } from '@dw/db/testing/fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebChannel, WEB_MAX_TEXT_LENGTH } from '../src/index.ts';

describe('web channel adapter (task 4.4)', () => {
  let pgTest: TestPostgres;
  let app: Database;

  beforeAll(async () => {
    pgTest = await startTestPostgres();
    app = createDatabase(pgTest.appUrl, { max: 3 });
  });

  afterAll(async () => {
    await app?.close();
    await pgTest?.stop();
  });

  it('stores the answer, splits long text and NOTIFYs ids only after commit', async () => {
    const tenant = await seedTenant(app, 'web');
    const workerId = await addWorker(app, tenant);
    const conversation = await withCompany(app, tenant.companyId, (tx) =>
      openConversation(tx, tenant.companyId, workerId, tenant.ownerMemberId),
    );
    const listener = new pg.Client({ connectionString: pgTest.appUrl });
    await listener.connect();
    const payloads: unknown[] = [];
    listener.on('notification', (msg) => payloads.push(JSON.parse(msg.payload ?? 'null')));
    await listener.query(`LISTEN ${CHAT_EVENTS_CHANNEL}`);
    try {
      const channel = createWebChannel(app);
      expect(channel.capabilities).toEqual({ groups: false, buttons: false, files: false });
      expect(channel.maxTextLength).toBe(WEB_MAX_TEXT_LENGTH);
      const target = {
        kind: 'web',
        companyId: tenant.companyId,
        workerId,
        chatExternalId: conversation.id,
      } as const;
      await channel.sendTyping(target);
      const secret = 'Nội dung bí mật của báo giá';
      const long = `${secret} ${'x'.repeat(WEB_MAX_TEXT_LENGTH)}`;
      const { externalIds } = await channel.send(target, {
        text: long,
        role: 'worker',
        taskId: null,
      });
      expect(externalIds).toHaveLength(2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const stored = await withCompany(app, tenant.companyId, (tx) =>
        listMessages(tx, conversation.id, { limit: 10 }),
      );
      expect(stored.map((m) => m.id)).toEqual(externalIds);
      expect(stored.every((m) => m.role === 'worker')).toBe(true);
      expect(payloads).toEqual([
        { companyId: tenant.companyId, conversationId: conversation.id, event: 'typing' },
        ...externalIds.map((messageId) => ({
          companyId: tenant.companyId,
          conversationId: conversation.id,
          event: 'message',
          messageId,
        })),
      ]);
      expect(JSON.stringify(payloads)).not.toContain(secret);
    } finally {
      await listener.end();
    }
  });
});
