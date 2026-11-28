import type { ChatMessage } from '@dw/db';
import type { ModelMessage } from '@dw/llm';

/**
 * History + the Task's grouped messages as model turns (design D4, D8.3): user messages →
 * `user`, worker answers → `assistant`, consecutive turns of one role merged, starting
 * with a user turn. In 1:1 web chat the person's own messages are the request: not wrapped
 * in <data> (D8.4).
 */
export function toModelMessages(
  history: readonly ChatMessage[],
  taskMessages: readonly ChatMessage[],
): ModelMessage[] {
  const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const message of [...history, ...taskMessages]) {
    if (message.role === 'notice') continue;
    const role = message.role === 'user' ? 'user' : 'assistant';
    const last = turns.at(-1);
    if (last?.role === role) last.text = `${last.text}\n${message.content}`;
    else turns.push({ role, text: message.content });
  }
  while (turns[0]?.role === 'assistant') turns.shift();
  return turns.map((turn) => ({ role: turn.role, content: turn.text }));
}
