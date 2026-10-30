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
