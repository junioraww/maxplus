import { test, expect } from "@playwright/test";

function generateRichDataset(chatId, count = 100) {
  const messages = [];
  const oneDayMs = 86400 * 1000;
  const baseTime = Date.now() - 5 * oneDayMs;

  for (let i = 1; i <= count; i++) {
    const dayOffset = Math.floor((i - 1) / (count / 5));
    const msgTime = baseTime + dayOffset * oneDayMs + (i % 20) * 60000;
    const msgId = chatId * 1000 + i;
    const isMe = i % 3 === 0;
    const typeCase = i % 12;

    let text = `Message #${i}`;
    let attaches = [];
    let link = null;
    let reactionInfo = null;

    switch (typeCase) {
      case 0:
        text = `Короткое сообщение #${i} для проверки базового скролла.`;
        break;

      case 1:
        text = `Длинное сообщение #${i} с большим количеством текста и переносов:\n` +
          Array.from({ length: 12 }, (_, idx) => `Абзац ${idx + 1}: подробное описание структуры данных, виртуализации DOM и тестирования нативных жестов.`).join("\n");
        break;

      case 2:
        text = `Одиночное фото #${i}`;
        attaches = [
          {
            _type: "PHOTO",
            photoId: msgId,
            width: (i % 2 === 0) ? 800 : 450,
            height: (i % 2 === 0) ? 450 : 800,
          },
        ];
        break;

      case 3:
        text = `Альбом из 2 фото #${i}`;
        attaches = [
          { _type: "PHOTO", photoId: msgId * 10 + 1, width: 600, height: 600 },
          { _type: "PHOTO", photoId: msgId * 10 + 2, width: 600, height: 600 },
        ];
        break;

      case 4:
        text = `Альбом из 4 фото #${i}`;
        attaches = [
          { _type: "PHOTO", photoId: msgId * 10 + 1, width: 400, height: 400 },
          { _type: "PHOTO", photoId: msgId * 10 + 2, width: 400, height: 400 },
          { _type: "PHOTO", photoId: msgId * 10 + 3, width: 400, height: 400 },
          { _type: "PHOTO", photoId: msgId * 10 + 4, width: 400, height: 400 },
        ];
        break;

      case 5:
        text = "";
        attaches = [
          {
            _type: "POLL",
            pollId: msgId,
            title: `Опрос #${i}: Какой метод виртуализации списка наиболее стабилен?`,
            answers: [
              { id: 1, text: "Фиксированные плейсхолдеры точной высоты" },
              { id: 2, text: "Двойной спейсер (Top/Bottom spacer)" },
              { id: 3, text: "Динамический ResizeObserver с компенсацией" },
              { id: 4, text: "Нативный content-visibility: auto" },
              { id: 5, text: "IntersectionObserver с постраничной разбивкой" },
            ],
            totalVotes: 89,
          },
        ];
        break;

      case 6:
        text = "";
        attaches = [
          {
            _type: "AUDIO",
            audioId: msgId,
            duration: 52,
            wave: Array.from({ length: 30 }, () => Math.random() * 0.8 + 0.2),
          },
        ];
        break;

      case 7:
        text = "";
        attaches = [
          {
            _type: "VIDEO",
            videoId: msgId,
            videoType: 1,
            isNote: true,
            duration: 18,
            width: 240,
            height: 240,
          },
        ];
        break;

      case 8:
        text = "";
        attaches = [
          {
            _type: "STICKER",
            stickerId: msgId,
            url: "/icons/sticker.svg",
            width: 140,
            height: 140,
          },
        ];
        break;

      case 9:
        text = `Техническая документация #${i}`;
        attaches = [
          {
            _type: "FILE",
            name: `specification_v${i}.pdf`,
            size: 3048576,
          },
        ];
        break;

      case 10:
        text = `Ответ на цитируемое сообщение #${i}`;
        link = {
          id: msgId - 1,
          type: "REPLY",
          text: `Контекст цитирования из предыдущего сообщения #${i - 1}`,
          sender: isMe ? 20002 : 10001,
          time: msgTime - 60000,
        };
        break;

      case 11:
        text = `Сообщение с блоком реакций #${i}`;
        reactionInfo = {
          totalCount: 12,
          counters: [
            { reaction: "🔥", count: 6 },
            { reaction: "👍", count: 4 },
            { reaction: "🎉", count: 2 },
          ],
        };
        break;
    }

    messages.push({
      id: msgId,
      chatId,
      sender: isMe ? 10001 : 20002,
      text,
      elements: [],
      attaches,
      link,
      reactionInfo,
      time: msgTime,
      status: 2,
      history: [],
    });
  }

  return messages;
}

test.describe("Realistic Physics Wheel & Swipe Scroll Test", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("verifies realistic wheel scrolling up without visual jumps or jittering across all message types", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();

    const chatId = 50001;
    const richMessages = generateRichDataset(chatId, 100);

    // Inject 100 rich messages of all 12 types into the mock API
    await page.evaluate(({ cId, msgs }) => {
      window.__API.messages[cId] = msgs;
      const targetChat = window.__API.chats.find((c) => Number(c.id) === Number(cId));
      if (targetChat) {
        targetChat.lastMessage = msgs[msgs.length - 1];
        targetChat.participants[window.__API.currentUserId] = msgs[msgs.length - 1].time;
      }
    }, { cId: chatId, msgs: richMessages });

    // Open chat
    await page.locator(".chat-item").first().click();

    const scrollEl = page.locator("#scroll");
    await expect(scrollEl).toBeVisible();
    await page.waitForTimeout(400);

    const scrollBox = await scrollEl.boundingBox();
    expect(scrollBox).toBeTruthy();

    // Start from the bottom
    await scrollEl.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);

    const centerX = scrollBox.x + scrollBox.width / 2;
    const centerY = scrollBox.y + scrollBox.height / 2;
    await page.mouse.move(centerX, centerY);

    const anomalies = [];
    const wheelStepDeltaY = -80; // 80px upward tick of mouse wheel
    const totalWheelTicks = 60;

    let previousPositions = new Map();
    let prevScrollTop = await scrollEl.evaluate((el) => el.scrollTop);

    for (let tick = 0; tick < totalWheelTicks; tick++) {
      // 1. Dispatch realistic hardware mouse wheel event
      await page.mouse.wheel(0, wheelStepDeltaY);
      await page.waitForTimeout(25);

      // 2. Sample visible messages
      const sample = await scrollEl.evaluate((el) => {
        const cRect = el.getBoundingClientRect();
        const wrappers = el.querySelectorAll(".message-wrapper");
        const visible = [];
        const items = [];
        for (let i = 0; i < wrappers.length; i++) {
          const w = wrappers[i];
          const r = w.getBoundingClientRect();
          const hasObserver = Boolean(w.querySelector(".observer-area"));
          const hasPlaceholder = Boolean(w.querySelector(".placeholder"));
          items.push({
            id: w.id,
            top: r.top - cRect.top,
            bottom: r.bottom - cRect.top,
            height: r.height,
            isRendered: hasObserver,
            isPlaceholder: hasPlaceholder,
          });
          if (r.bottom > cRect.top && r.top < cRect.bottom) {
            visible.push({
              id: w.id,
              top: r.top - cRect.top,
              height: r.height,
            });
          }
        }
        return {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          visible,
          items,
        };
      });

      const currentScrollTop = sample.scrollTop;
      const currentPositions = new Map(sample.visible.map((v) => [v.id, v]));

      // Check A: Monotonic scroll direction check (when turning wheel upwards, scrollTop must not increase)
      if (currentScrollTop > prevScrollTop + 1.5 && prevScrollTop > 0) {
        anomalies.push({
          tick,
          type: "SCROLL_TOP_REVERSED",
          prevScrollTop,
          currentScrollTop,
          delta: currentScrollTop - prevScrollTop,
        });
      }

      // Check B: Compare positions of all messages that were visible in both consecutive samples
      for (const [id, curr] of currentPositions) {
        const prev = previousPositions.get(id);
        if (prev) {
          const visualDisplacement = curr.top - prev.top;
          const scrollDelta = prevScrollTop - currentScrollTop;
          const unexpectedLayoutShift = visualDisplacement - scrollDelta;

          // When scrolling UP with wheel, messages on screen must move DOWN (visualDisplacement >= 0)
          // If a message moves UP by more than 2px while scrolling up, it's a visual reverse bounce / jitter!
          if (visualDisplacement < -2 && scrollDelta >= 0) {
            anomalies.push({
              tick,
              type: "VISUAL_REVERSE_JITTER",
              msgId: id,
              prevTop: prev.top,
              currentTop: curr.top,
              visualDisplacement,
              scrollDelta,
            });
          }

          // If a message moves independently of the scrollbar by more than 12px:
          if (Math.abs(unexpectedLayoutShift) > 12) {
            anomalies.push({
              tick,
              type: "UNEXPECTED_LAYOUT_SHIFT_JUMP",
              msgId: id,
              unexpectedLayoutShift,
              visualDisplacement,
              scrollDelta,
              prevTop: prev.top,
              currentTop: curr.top,
              prevHeight: prev.height,
              currHeight: curr.height,
            });
          }
        }
      }

      previousPositions = currentPositions;
      prevScrollTop = currentScrollTop;
    }

    console.log(`[REALISTIC SCROLL TEST] Completed ${totalWheelTicks} wheel ticks. Anomalies found: ${anomalies.length}`);
    if (anomalies.length > 0) {
      console.log(`[ANOMALIES SAMPLE]`, JSON.stringify(anomalies.slice(0, 8), null, 2));
    }

    expect(anomalies, `Expected 0 jitter/jump anomalies, but found ${anomalies.length}`).toHaveLength(0);
  });
});
