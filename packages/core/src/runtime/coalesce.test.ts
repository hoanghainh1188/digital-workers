import { describe, expect, it } from 'vitest';
import { canJoinWindow, DEFAULT_COALESCE_WINDOW, windowClosesIn } from './coalesce.ts';

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 28, 3, 0, 0) + seconds * 1000);
const task = (first: number, last: number, count: number) => ({
  firstMessageAt: at(first),
  lastMessageAt: at(last),
  messageCount: count,
});

describe('message coalescing (FR-04-07, 0.2 #124)', () => {
  it('3 messages 2–3 seconds apart join one Task', () => {
    expect(canJoinWindow(task(0, 0, 1), at(2), DEFAULT_COALESCE_WINDOW)).toBe(true);
    expect(canJoinWindow(task(0, 2, 2), at(5), DEFAULT_COALESCE_WINDOW)).toBe(true);
  });

  it('a message 8 seconds later starts a new Task', () => {
    expect(canJoinWindow(task(0, 0, 1), at(8), DEFAULT_COALESCE_WINDOW)).toBe(false);
  });

  it('the window closes 30 seconds after the first message, even with short gaps', () => {
    expect(canJoinWindow(task(0, 28, 10), at(29), DEFAULT_COALESCE_WINDOW)).toBe(true);
    expect(canJoinWindow(task(0, 29, 11), at(30), DEFAULT_COALESCE_WINDOW)).toBe(false);
    expect(windowClosesIn(task(0, 28, 10), at(28), DEFAULT_COALESCE_WINDOW)).toBe(2_000);
  });

  it('the 21st message starts a new Task and a full window closes at once', () => {
    expect(canJoinWindow(task(0, 10, 20), at(11), DEFAULT_COALESCE_WINDOW)).toBe(false);
    expect(windowClosesIn(task(0, 10, 20), at(10), DEFAULT_COALESCE_WINDOW)).toBe(0);
  });

  it('closes 5 seconds after the last message', () => {
    expect(windowClosesIn(task(0, 3, 2), at(5), DEFAULT_COALESCE_WINDOW)).toBe(3_000);
    expect(windowClosesIn(task(0, 3, 2), at(9), DEFAULT_COALESCE_WINDOW)).toBe(0);
  });
});
