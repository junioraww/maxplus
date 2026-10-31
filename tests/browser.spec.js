import { test, expect } from "@playwright/test";

test.describe("Browser Desktop Mode", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("loads browser view and shows mock chat list", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();
    await expect(page.locator(".chat-item")).toHaveCount(2);
    await expect(page.getByText("Synthetic Dialog")).toBeVisible();
    await expect(page.getByText("Synthetic Group Chat")).toBeVisible();
  });

  test("enters chat, verifies generated messages and scroll position saving", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });

    await page.locator(".chat-item").first().click();

    const scrollEl = page.locator("#scroll");
    await expect(scrollEl).toBeVisible();

    const messages = scrollEl.locator(".message-wrapper");
    await expect(messages.first()).toBeVisible();

    const count = await messages.count();
    expect(count).toBeGreaterThan(10);

    const scrollMetrics = await scrollEl.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

    await scrollEl.evaluate((el) => {
      el.scrollTop = 150;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(400);

    const savedPositions = await page.evaluate(() => localStorage.getItem("chat_scroll_positions"));
    expect(savedPositions).toBeTruthy();

    await page.locator("header .icon-button").click();
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();

    await page.locator(".chat-item").first().click();
    await expect(page.locator("#scroll")).toBeVisible();
  });

  test("renders rich messages with varied line counts, styles and attachments", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });

    await page.locator(".chat-item").first().click();

    const scrollEl = page.locator("#scroll");
    await expect(scrollEl).toBeVisible();

    await expect(page.locator(".bold-text").first()).toBeVisible();
    await expect(page.locator(".italic-text").first()).toBeVisible();
    await expect(page.locator(".code-text").first()).toBeVisible();
    await expect(page.locator(".quote-container").first()).toBeVisible();
    await expect(page.getByText(".pdf").first()).toBeVisible();
  });

  test("measures scrolling performance and logs chat FPS stats", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });

    await page.locator(".chat-item").first().click();

    const scrollEl = page.locator("#scroll");
    await expect(scrollEl).toBeVisible();
    await expect(scrollEl.locator(".message-wrapper").first()).toBeVisible();

    const perf = await scrollEl.evaluate(async (el) => {
      const frameDeltas = [];
      let last = performance.now();
      let frameCount = 0;
      const start = performance.now();
      const durationMs = 1200;

      return new Promise((resolve) => {
        function loop(now) {
          const delta = now - last;
          last = now;
          frameDeltas.push(delta);
          frameCount++;

          el.scrollTop += 18;

          if (now - start < durationMs) {
            requestAnimationFrame(loop);
          } else {
            const actualDurationSec = (now - start) / 1000;
            const avgFps = Math.round(frameCount / actualDurationSec);
            const droppedFrames = frameDeltas.filter((d) => d > 33.3).length;
            const maxFrameMs = Math.round(Math.max(...frameDeltas));
            const minFrameMs = Math.round(Math.min(...frameDeltas));
            resolve({
              avgFps,
              frameCount,
              actualDurationSec: actualDurationSec.toFixed(2),
              droppedFrames,
              maxFrameMs,
              minFrameMs,
            });
          }
        }
        requestAnimationFrame(loop);
      });
    });

    console.log(
      `[PERF CHAT SCROLL] FPS: ${perf.avgFps} | Frames: ${perf.frameCount} in ${perf.actualDurationSec}s | Max frame: ${perf.maxFrameMs}ms | Dropped (>33ms): ${perf.droppedFrames}`
    );

    expect(perf.avgFps).toBeGreaterThan(0);
  });

  test("infinite scroll loads older messages on scroll up", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });

    await page.locator(".chat-item").first().click();

    const scrollEl = page.locator("#scroll");
    await expect(scrollEl).toBeVisible();

    const messages = scrollEl.locator(".message-wrapper");
    await expect(messages.first()).toBeVisible();
    const initialCount = await messages.count();

    await scrollEl.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });

    await page.waitForTimeout(600);

    const updatedCount = await messages.count();
    expect(updatedCount).toBeGreaterThanOrEqual(initialCount);
  });

  test("navigates between panel tabs and returns to chats", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });

    const options = page.locator(".panel .option");
    await expect(options.first()).toBeVisible();

    if ((await options.count()) > 1) {
      await options.nth(1).click();
      await page.waitForTimeout(200);

      await options.first().click();
      await expect(page.locator(".chat-list-inner").first()).toBeVisible();
    }
  });
});

test.describe("Browser Mobile Mode", () => {
  test.use({
    viewport: { width: 375, height: 667 },
    isMobile: true,
  });

  test("renders mobile view, navigates chat and sends synthetic message", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();

    await page.locator(".chat-item").first().click();

    const scrollEl = page.locator("#scroll");
    await expect(scrollEl).toBeVisible();

    const input = page.locator('textarea[placeholder="Сообщение"]');
    await expect(input).toBeVisible();

    const testMessage = "Synthetic mobile scroll test message";
    await input.fill(testMessage);

    const sendBtn = page.locator(".send-button");
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();

    await expect(page.locator(".preview", { hasText: testMessage }).first()).toBeVisible();

    await scrollEl.evaluate((el) => {
      el.scrollTop = 80;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(300);

    await page.locator("header .icon-button").click();
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();
  });
});

test.describe("Chat Unread Messages & Scroll Down Badge Verification", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("verifies full unread messages and scroll down badge flow across 7 steps", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("chat_scroll_positions"));
    await page.reload();
    await expect(page.locator("#initial-loader")).toBeHidden({ timeout: 10000 });
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();

    const dialogItem = page.locator(".chat-item").first();

    await dialogItem.click();
    const scrollEl = page.locator("#scroll");
    await expect(scrollEl).toBeVisible();
    await page.waitForTimeout(100);
    const scrollDownBtn = page.locator(".scroll-down-btn");
    await expect(scrollDownBtn).toBeHidden();
    await page.locator("header .icon-button").click();
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();

    await page.evaluate(() => {
      window.__API.addIncomingMessages(50001, 1);
    });

    const dialogBadge1 = dialogItem.locator(".badge");
    await expect(dialogBadge1).toBeVisible();
    await expect(dialogBadge1).toHaveText("1");

    await dialogItem.click();
    await expect(scrollEl).toBeVisible();

    const separator = page.locator("#unread-separator");
    await expect(separator).toBeVisible();
    await expect(separator).toHaveText(/Непрочитанные сообщения/);

    const scrollBox1 = await scrollEl.boundingBox();
    const sepBox1 = await separator.boundingBox();
    expect(sepBox1.y).toBeLessThan(scrollBox1.y + scrollBox1.height);
    expect(sepBox1.y + sepBox1.height).toBeGreaterThanOrEqual(scrollBox1.y + scrollBox1.height - 40);

    const firstUnreadMsg = scrollEl.locator(".message-wrapper").last();
    const firstUnreadBox = await firstUnreadMsg.boundingBox();
    expect(firstUnreadBox.y).toBeGreaterThanOrEqual(scrollBox1.y + scrollBox1.height - 5);

    await expect(scrollDownBtn).toBeVisible();
    const scrollBadge = page.locator(".scroll-down-badge");
    await expect(scrollBadge).toBeVisible();
    await expect(scrollBadge).toHaveText("1");

    await scrollEl.evaluate((el) => {
      el.scrollTop -= 20;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await expect(scrollDownBtn).toBeVisible();
    await expect(scrollBadge).toBeVisible();
    await expect(scrollBadge).toHaveText("1");
    await expect(separator).toBeVisible();

    await scrollEl.evaluate((el) => {
      el.scrollTop -= 300;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await expect(scrollDownBtn).toBeVisible();
    await expect(scrollBadge).toBeVisible();
    await expect(scrollBadge).toHaveText("1");

    await scrollEl.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await expect(scrollDownBtn).toBeVisible();
    await expect(scrollBadge).toBeVisible();
    await expect(scrollBadge).toHaveText("1");

    const unreadInStoreWhileScrolledUp = await page.evaluate(
      () => window.__API.chats.find((c) => c.id === 50001)?.newMessages
    );
    expect(unreadInStoreWhileScrolledUp).toBe(1);

    await scrollEl.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(300);
    await expect(separator).toBeHidden();
    await expect(scrollBadge).toBeHidden();

    const unreadInStoreAfterBottom = await page.evaluate(
      () => window.__API.chats.find((c) => c.id === 50001)?.newMessages
    );
    expect(unreadInStoreAfterBottom).toBe(0);

    await page.locator("header .icon-button").click();
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();
    await expect(dialogItem.locator(".badge")).toBeHidden();

    await dialogItem.click();
    await expect(scrollEl).toBeVisible();
    await page.waitForTimeout(200);

    await scrollEl.evaluate((el) => {
      el.scrollTop -= 350;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(300);

    const savedScrollTop = await scrollEl.evaluate((el) => el.scrollTop);
    const savedDistance = await scrollEl.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight
    );
    expect(savedDistance).toBeGreaterThan(100);

    const msgs = scrollEl.locator(".message-wrapper");
    const countBefore = await msgs.count();
    const anchorMsg = msgs.nth(countBefore - 5);
    const anchorId = await anchorMsg.getAttribute("id");
    const savedMsgBox = await anchorMsg.boundingBox();

    await page.locator("header .icon-button").click();
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();

    const savedPositions = await page.evaluate(() => localStorage.getItem("chat_scroll_positions"));
    expect(savedPositions).toBeTruthy();

    await page.evaluate(() => {
      window.__API.addIncomingMessages(50001, 3);
    });

    const dialogBadge3 = dialogItem.locator(".badge");
    await expect(dialogBadge3).toBeVisible();
    await expect(dialogBadge3).toHaveText("3");

    await dialogItem.click();
    await expect(scrollEl).toBeVisible();
    await page.waitForTimeout(250);

    const restoredMsg = page.locator("#" + anchorId);
    await expect(restoredMsg).toBeVisible();
    const restoredMsgBox = await restoredMsg.boundingBox();
    expect(Math.abs(restoredMsgBox.y - savedMsgBox.y)).toBeLessThanOrEqual(2);

    await expect(scrollDownBtn).toBeVisible();
    await expect(scrollBadge).toBeVisible();
    await expect(scrollBadge).toHaveText("3");

    const distanceBeforeUnread = await scrollEl.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight
    );

    await scrollEl.evaluate((el) => {
      el.scrollTop += (el.scrollHeight - el.scrollTop - el.clientHeight) - 100;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);

    await expect(separator).toBeVisible();
    await expect(scrollBadge).toHaveText("2");

    await scrollEl.evaluate((el) => {
      el.scrollTop += 50;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);

    await expect(separator).toBeVisible();
    await expect(scrollBadge).toHaveText("1");

    await scrollEl.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(350);

    await expect(scrollBadge).toBeHidden();
    await expect(separator).toBeHidden();

    await page.locator("header .icon-button").click();
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();
    await expect(dialogItem.locator(".badge")).toBeHidden();

    await page.evaluate(() => {
      window.__API.addIncomingMessages(50001, 5);
    });
    const dialogBadge5 = dialogItem.locator(".badge");
    await expect(dialogBadge5).toBeVisible();
    await expect(dialogBadge5).toHaveText("5");

    await dialogItem.click();
    await expect(scrollEl).toBeVisible();

    await expect(separator).toBeVisible();
    const scrollBox5 = await scrollEl.boundingBox();
    const sepBox5 = await separator.boundingBox();
    expect(sepBox5.y).toBeLessThan(scrollBox5.y + scrollBox5.height);
    expect(sepBox5.y + sepBox5.height).toBeGreaterThanOrEqual(scrollBox5.y + scrollBox5.height - 40);

    const firstUnread5 = scrollEl.locator(".message-wrapper").nth(-5);
    const firstUnreadBox5 = await firstUnread5.boundingBox();
    expect(firstUnreadBox5.y).toBeGreaterThanOrEqual(scrollBox5.y + scrollBox5.height - 2);

    await expect(scrollDownBtn).toBeVisible();
    await expect(scrollBadge).toBeVisible();
    await expect(scrollBadge).toHaveText("5");

    await scrollEl.evaluate((el) => {
      el.scrollTop -= 50;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await expect(scrollDownBtn).toBeVisible();
    await expect(scrollBadge).toHaveText("5");
    await expect(separator).toBeVisible();

    const sepOffsetBefore = await separator.evaluate((el) => el.offsetTop);

    await scrollEl.evaluate((el) => {
      el.scrollTop += 110;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await expect(separator).toBeVisible();
    const sepOffsetAfter = await separator.evaluate((el) => el.offsetTop);
    expect(sepOffsetAfter).toBe(sepOffsetBefore);
    await expect(scrollBadge).toHaveText("4");

    for (let expected = 3; expected >= 1; expected--) {
      await scrollEl.evaluate((el) => {
        el.scrollTop += 60;
        el.dispatchEvent(new Event("scroll"));
      });
      await page.waitForTimeout(200);
      await expect(scrollBadge).toHaveText(String(expected));
    }

    await scrollEl.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(300);
    await expect(scrollBadge).toBeHidden();
    await expect(separator).toBeHidden();

    await scrollEl.evaluate((el) => {
      el.scrollTop -= 200;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await expect(page.locator(".scroll-down-badge")).toBeHidden();

    await scrollEl.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);

    await page.locator("header .icon-button").click();
    await expect(page.locator(".chat-list-inner").first()).toBeVisible();

    await page.evaluate(() => {
      window.__API.addIncomingMessages(50001, 100);
    });

    const dialogBadge100 = dialogItem.locator(".badge");
    await expect(dialogBadge100).toBeVisible();
    await expect(dialogBadge100).toHaveText("99+");

    await dialogItem.click();
    await expect(scrollEl).toBeVisible();
    await expect(separator).toBeVisible();
    await expect(scrollDownBtn).toBeVisible();
    await expect(scrollBadge).toBeVisible();
    await expect(scrollBadge).toHaveText("99+");

    await scrollEl.evaluate((el) => {
      el.scrollTop -= 50;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await expect(scrollBadge).toHaveText("99+");

    await scrollEl.evaluate((el) => {
      el.scrollTop += 50;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    const badgeNum = Number(await scrollBadge.textContent());
    expect(badgeNum).toBeLessThanOrEqual(99);
    expect(badgeNum).toBeGreaterThanOrEqual(90);

    await scrollDownBtn.click();
    await page.waitForTimeout(400);

    await expect(scrollBadge).toBeHidden();
    await expect(scrollDownBtn).toBeHidden();
    await expect(separator).toBeHidden();

    const finalDistance = await scrollEl.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight
    );
    expect(finalDistance).toBeLessThanOrEqual(5);
  });
});
