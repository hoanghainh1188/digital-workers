import type { ChannelAdapter, ChannelTarget, OutgoingMessage } from './types.ts';

export type RecordedSend =
  | { readonly type: 'send'; readonly target: ChannelTarget; readonly message: OutgoingMessage }
  | { readonly type: 'typing'; readonly target: ChannelTarget };

/** A channel that records every send and typing call, in order (tests only). */
export function createFakeChannel(
  options: { readonly maxTextLength?: number } = {},
): ChannelAdapter & { readonly sent: RecordedSend[] } {
  const sent: RecordedSend[] = [];
  let counter = 0;
  return {
    kind: 'web',
    maxTextLength: options.maxTextLength ?? 8000,
    capabilities: { groups: false, buttons: false, files: false },
    sent,
    send: async (target, message) => {
      sent.push({ type: 'send', target, message });
      counter += 1;
      return { externalIds: [`fake-${counter}`] };
    },
    sendTyping: async (target) => {
      sent.push({ type: 'typing', target });
    },
  };
}
