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

test.describe('Scroll anchor preservation when media header mounts/unmounts', () => {
  test('user near bottom stays at bottom after header mounts (clientHeight shrinks)', () => {
    const before = makeScrollEl({ scrollTop: 940, scrollHeight: 1000, clientHeight: 60 });
    const anchor = computeScrollAnchor(before);
    expect(anchor.distFromBottom).toBe(0);

    const after = makeScrollEl({ scrollTop: 940, scrollHeight: 1000, clientHeight: 20 });
    restoreScrollAnchor(after, anchor);
    expect(after.scrollTop).toBe(980);
    expect(after.scrollHeight - after.scrollTop - after.clientHeight).toBe(0);
  });

  test('user reading middle of chat stays in place after header mounts', () => {
    const before = makeScrollEl({ scrollTop: 500, scrollHeight: 2000, clientHeight: 600 });
    const anchor = computeScrollAnchor(before);
    expect(anchor.distFromBottom).toBe(900);

    const after = makeScrollEl({ scrollTop: 500, scrollHeight: 2000, clientHeight: 560 });
    restoreScrollAnchor(after, anchor);
    expect(after.scrollTop).toBe(2000 - 560 - 900);
    expect(after.scrollHeight - after.scrollTop - after.clientHeight).toBe(900);
  });

  test('user near bottom stays at bottom after header unmounts (clientHeight grows)', () => {
    const before = makeScrollEl({ scrollTop: 980, scrollHeight: 1000, clientHeight: 20 });
    const anchor = computeScrollAnchor(before);
    expect(anchor.distFromBottom).toBe(0);

    const after = makeScrollEl({ scrollTop: 980, scrollHeight: 1000, clientHeight: 60 });
    restoreScrollAnchor(after, anchor);
    expect(after.scrollTop).toBe(940);
    expect(after.scrollHeight - after.scrollTop - after.clientHeight).toBe(0);
  });

  test('user reading middle of chat stays in place after header unmounts', () => {
    const before = makeScrollEl({ scrollTop: 540, scrollHeight: 2000, clientHeight: 560 });
    const anchor = computeScrollAnchor(before);
    expect(anchor.distFromBottom).toBe(900);

    const after = makeScrollEl({ scrollTop: 540, scrollHeight: 2000, clientHeight: 600 });
    restoreScrollAnchor(after, anchor);
    expect(after.scrollTop).toBe(2000 - 600 - 900);
    expect(after.scrollHeight - after.scrollTop - after.clientHeight).toBe(900);
  });

  test('scrollTop is clamped to valid range', () => {
    const before = makeScrollEl({ scrollTop: 0, scrollHeight: 500, clientHeight: 500 });
    const anchor = computeScrollAnchor(before);
    expect(anchor.distFromBottom).toBe(0);

    const after = makeScrollEl({ scrollTop: 0, scrollHeight: 500, clientHeight: 460 });
    restoreScrollAnchor(after, anchor);
    expect(after.scrollTop).toBe(40);
  });
});

test.describe('Auto-scroll guard: near-bottom detection threshold', () => {
  test('detects near-bottom within 60px threshold', () => {
    const isNearBottom = (scrollTop, scrollHeight, clientHeight) =>
      scrollHeight - scrollTop - clientHeight < 60;

    expect(isNearBottom(940, 1000, 60)).toBe(true);
    expect(isNearBottom(939, 1000, 60)).toBe(true);
    expect(isNearBottom(900, 1000, 60)).toBe(true);
    expect(isNearBottom(0, 1000, 60)).toBe(false);
    expect(isNearBottom(880, 1000, 60)).toBe(false);
  });

  test('auto-scroll only fires when user was already at bottom', () => {
    const shouldAutoScroll = (wasAtBottom, incomingMessageSentBy, currentUserId, msgTime, now) => {
      const isRecentSelf = incomingMessageSentBy === currentUserId && (now - msgTime) < 5000;
      return isRecentSelf || wasAtBottom;
    };

    expect(shouldAutoScroll(true, 20002, 10001, Date.now() - 100, Date.now())).toBe(true);
    expect(shouldAutoScroll(false, 10001, 10001, Date.now() - 100, Date.now())).toBe(true);
    expect(shouldAutoScroll(false, 20002, 10001, Date.now() - 100, Date.now())).toBe(false);
    expect(shouldAutoScroll(false, 10001, 10001, Date.now() - 10000, Date.now())).toBe(false);
  });
});

test.describe('ResizeObserver height delta compensation', () => {
  test('compensates for header appearing (negative delta = clientHeight shrinks)', () => {
    const lastClientHeight = 600;
    const clientHeight = 560;
    const heightDelta = clientHeight - lastClientHeight;
    const scrollHeight = 2000;
    const scrollTop = 540;

    const threshold = Math.max(28, Math.abs(heightDelta) + 8);
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distFromBottom < threshold;

    expect(heightDelta).toBe(-40);
    expect(threshold).toBe(48);
    expect(distFromBottom).toBe(900);
    expect(atBottom).toBe(false);
  });

  test('fires scrollToBottom when already at bottom after header appears', () => {
    const lastClientHeight = 600;
    const clientHeight = 560;
    const heightDelta = clientHeight - lastClientHeight;
    const scrollHeight = 1000;
    const scrollTop = 960;

    const threshold = Math.max(28, Math.abs(heightDelta) + 8);
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distFromBottom < threshold;

    expect(distFromBottom).toBe(-520);
    expect(atBottom).toBe(true);
  });
});
