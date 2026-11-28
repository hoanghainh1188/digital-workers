import { type Database, insertMessage, lockConversation, notifyChat, withCompany } from '@dw/db';
import { splitText } from './split-text.ts';
import type { ChannelAdapter } from './types.ts';

export const WEB_MAX_TEXT_LENGTH = 8000;

/**
 * Web chat adapter (design D3, D10): `send` stores the message in `task_messages` and
 * NOTIFYs api processes in the same transaction (delivered only after commit, payload ids
 * only); `sendTyping` only NOTIFYs. The conversation id is the target's chat id.
 */
export function createWebChannel(database: Pick<Database, 'db'>): ChannelAdapter {
  const adapter: ChannelAdapter = {
    kind: 'web',
    maxTextLength: WEB_MAX_TEXT_LENGTH,
    capabilities: Object.freeze({ groups: false, buttons: false, files: false }),
    send: (target, message) =>
      withCompany(database, target.companyId, async (tx) => {
        const conversationId = target.chatExternalId;
        await lockConversation(tx, conversationId);
        const externalIds: string[] = [];
        for (const part of splitText(message.text, WEB_MAX_TEXT_LENGTH)) {
          const { message: stored } = await insertMessage(tx, {
            companyId: target.companyId,
            conversationId,
            taskId: message.taskId,
            role: message.role,
            content: part,
          });
          externalIds.push(stored.id);
          await notifyChat(tx, {
            companyId: target.companyId,
            conversationId,
            event: 'message',
            messageId: stored.id,
          });
        }
        return { externalIds };
      }),
    sendTyping: (target) =>
      withCompany(database, target.companyId, (tx) =>
        notifyChat(tx, {
          companyId: target.companyId,
          conversationId: target.chatExternalId,
          event: 'typing',
        }),
      ),
  };
  return Object.freeze(adapter);
}
