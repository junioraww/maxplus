import { test, expect } from '@playwright/test';

function makeScrollEl({ scrollTop, scrollHeight, clientHeight }) {
  return { scrollTop, scrollHeight, clientHeight };
}

function computeScrollAnchor(el) {
  return {
    scrollTop: el.scrollTop,
    distFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
  };
}

function restoreScrollAnchor(el, anchor) {
  const { distFromBottom } = anchor;
  const { scrollHeight, clientHeight } = el;
  if (distFromBottom < 60) {
    el.scrollTop = scrollHeight - clientHeight;
  } else {
    el.scrollTop = scrollHeight - clientHeight - distFromBottom;
  }
}

test.describe('Scroll anchor preservation', () => {
  test('user near bottom stays at bottom after layout changes', () => {
    const before = makeScrollEl({ scrollTop: 940, scrollHeight: 1000, clientHeight: 60 });
    const anchor = computeScrollAnchor(before);
    expect(anchor.distFromBottom).toBe(0);

    const after = makeScrollEl({ scrollTop: 940, scrollHeight: 1000, clientHeight: 20 });
    restoreScrollAnchor(after, anchor);
    expect(after.scrollTop).toBe(980);
    expect(after.scrollHeight - after.scrollTop - after.clientHeight).toBe(0);
  });

  test('user reading middle of chat stays in place', () => {
    const before = makeScrollEl({ scrollTop: 500, scrollHeight: 2000, clientHeight: 600 });
    const anchor = computeScrollAnchor(before);
    expect(anchor.distFromBottom).toBe(900);

    const after = makeScrollEl({ scrollTop: 500, scrollHeight: 2000, clientHeight: 560 });
    restoreScrollAnchor(after, anchor);
    expect(after.scrollTop).toBe(2000 - 560 - 900);
    expect(after.scrollHeight - after.scrollTop - after.clientHeight).toBe(900);
  });

  test('preserves existing playlist items when parsing media playlist context', async () => {
    const { buildChatPlaylist } = await import('../src/lib/stores/mediaPlayback.js');
    const syntheticItems = [
      { id: 'synth_1', chatId: 100, messageId: 1001, type: 'voice', duration: 10, time: 1000, attach: { duration: 10 } },
      { id: 'synth_2', chatId: 100, messageId: 1002, type: 'voice', duration: 15, time: 2000, attach: { duration: 15 } },
    ];
    const res = await buildChatPlaylist(100, 1002, syntheticItems, 1);
    expect(res.length).toBe(2);
    expect(res[0].id).toBe('synth_1');
    expect(res[1].id).toBe('synth_2');
  });
});

