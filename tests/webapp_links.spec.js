import { test, expect } from "@playwright/test";
import { extractMaxUrlInfo, processMaxLink } from "../src/lib/utils/maxLink.js";

test.describe("Max link parser and bot link extractor", () => {
  test("extracts bot target and start payload from standard https max.ru link", () => {
    const res = extractMaxUrlInfo("https://max.ru/synthetic_bot?start=payload_123");
    expect(res).not.toBeNull();
    expect(res?.isMax).toBe(true);
    expect(res?.kind).toBe("entity");
    expect(res?.targetName).toBe("synthetic_bot");
    expect(res?.canonicalUrl).toBe("https://max.ru/synthetic_bot");
    expect(res?.startPayload).toBe("payload_123");
    expect(res?.startAppParam).toBeNull();
  });

  test("handles schemeless links and leading @ in target name", () => {
    const res = extractMaxUrlInfo("max.ru/@synthetic_alpha?start=start_token");
    expect(res).not.toBeNull();
    expect(res?.targetName).toBe("synthetic_alpha");
    expect(res?.canonicalUrl).toBe("https://max.ru/synthetic_alpha");
    expect(res?.startPayload).toBe("start_token");
  });

  test("handles www prefix, http scheme, and max protocol links", () => {
    const resHttp = extractMaxUrlInfo("http://www.max.ru/synthetic_beta?start=beta_payload");
    expect(resHttp?.targetName).toBe("synthetic_beta");
    expect(resHttp?.startPayload).toBe("beta_payload");

    const resMaxScheme = extractMaxUrlInfo("max://max.ru/synthetic_gamma?start=gamma_payload");
    expect(resMaxScheme?.targetName).toBe("synthetic_gamma");
    expect(resMaxScheme?.startPayload).toBe("gamma_payload");

    const resShortMax = extractMaxUrlInfo("max://synthetic_delta?start=delta_payload");
    expect(resShortMax?.targetName).toBe("synthetic_delta");
    expect(resShortMax?.startPayload).toBe("delta_payload");

    const resMultiPath = extractMaxUrlInfo("max://join/synthetic_invite_999");
    expect(resMultiPath?.canonicalUrl).toBe("https://max.ru/join/synthetic_invite_999");

    const resWebMultiPath = extractMaxUrlInfo("https://max.ru/join/synthetic_invite_888");
    expect(resWebMultiPath?.canonicalUrl).toBe("https://max.ru/join/synthetic_invite_888");
  });

  test("extracts encoded start payload with special characters", () => {
    const res = extractMaxUrlInfo("https://max.ru/synthetic_bot?start=item%2042%2Bref");
    expect(res?.startPayload).toBe("item 42+ref");
  });

  test("handles empty start parameter and link without start parameter", () => {
    const resEmpty = extractMaxUrlInfo("max.ru/synthetic_bot?start=");
    expect(resEmpty?.startPayload).toBe("");

    const resNone = extractMaxUrlInfo("max.ru/synthetic_bot");
    expect(resNone?.startPayload).toBeNull();
    expect(resNone?.kind).toBe("entity");
  });

  test("recognizes startapp parameter for mini app links", () => {
    const res = extractMaxUrlInfo("https://max.ru/synthetic_app_bot?startapp=feature_sub");
    expect(res?.kind).toBe("app");
    expect(res?.targetName).toBe("synthetic_app_bot");
    expect(res?.startAppParam).toBe("feature_sub");
  });

  test("rejects reserved routes and non-max domains", () => {
    expect(extractMaxUrlInfo("https://max.ru/login")).toBeNull();
    expect(extractMaxUrlInfo("https://max.ru/tos")).toBeNull();
    expect(extractMaxUrlInfo("https://max.ru/privacy")).toBeNull();
    expect(extractMaxUrlInfo("https://max.ru/ps")).toBeNull();
    expect(extractMaxUrlInfo("https://max.ru/help")).toBeNull();
    expect(extractMaxUrlInfo("https://max.ru/about")).toBeNull();

    expect(extractMaxUrlInfo("https://evil.max.ru/synthetic_bot?start=x")).toBeNull();
    expect(extractMaxUrlInfo("https://max.rules/synthetic_bot?start=x")).toBeNull();
    expect(extractMaxUrlInfo("https://example.com/max.ru")).toBeNull();
    expect(extractMaxUrlInfo("not a link")).toBeNull();
    expect(extractMaxUrlInfo("")).toBeNull();
  });
});

test.describe("Max link processing and bot starting", () => {
  test("resolves contact bot, executes sendBotStart with startPayload, and opens chat", async () => {
    let sentChatId = null;
    let sentPayload = null;
    let openedChatId = null;
    let resolvedTarget = null;

    const fakeApi = {
      resolveLink: async (link) => {
        resolvedTarget = link;
        return {
          user: {
            contact: {
              id: 990011,
              names: [{ name: "Synthetic Bot" }],
            },
          },
        };
      },
      sendBotStart: async (chatId, payload) => {
        sentChatId = chatId;
        sentPayload = payload;
        return {
          message: {
            id: "msg_synthetic_start_1",
            text: "started",
          },
        };
      },
    };

    const currentUserId = 100000;
    const expectedChatId = Number(BigInt(currentUserId) ^ BigInt(990011));

    const result = await processMaxLink("https://max.ru/synth_bot?start=action_code_9", {
      currentUserId,
      api: fakeApi,
      onOpenChat: async (chatId) => {
        openedChatId = chatId;
      },
    });

    expect(result).toBe(true);
    expect(resolvedTarget).toBe("https://max.ru/synth_bot");
    expect(sentChatId).toBe(expectedChatId);
    expect(sentPayload).toBe("action_code_9");
    expect(openedChatId).toBe(expectedChatId);
  });

  test("resolves chat bot without start payload and opens chat without sendBotStart", async () => {
    let sentBotStartCalled = false;
    let openedChatId = null;

    const fakeApi = {
      resolveLink: async () => ({
        chat: {
          id: 554433,
          title: "Synthetic Chat Bot",
        },
      }),
      sendBotStart: async () => {
        sentBotStartCalled = true;
      },
    };

    const result = await processMaxLink("max.ru/synth_chat_bot", {
      currentUserId: 100000,
      api: fakeApi,
      onOpenChat: async (chatId) => {
        openedChatId = chatId;
      },
    });

    expect(result).toBe(true);
    expect(sentBotStartCalled).toBe(false);
    expect(openedChatId).toBe(554433);
  });

  test("resolves mini app link and invokes onLaunchApp with startParam", async () => {
    let launchedApp = null;

    const fakeApi = {
      resolveLink: async () => ({
        user: {
          id: 887766,
          contact: {
            names: [{ name: "Synthetic Mini App" }],
          },
        },
      }),
    };

    const result = await processMaxLink("https://max.ru/synth_app?startapp=param_xyz", {
      currentUserId: 100000,
      api: fakeApi,
      onLaunchApp: async (appData) => {
        launchedApp = appData;
      },
    });

    expect(result).toBe(true);
    expect(launchedApp?.botId).toBe(887766);
    expect(launchedApp?.startParam).toBe("param_xyz");
    expect(launchedApp?.entryPoint).toBe("link");
  });

  test("ignores non-max links and returns false", async () => {
    let called = false;
    const result = await processMaxLink("https://external-example.com/item", {
      onOpenChat: async () => {
        called = true;
      },
    });
    expect(result).toBe(false);
    expect(called).toBe(false);
  });
});

test.describe("WebApp inner navigation state logic", () => {
  test("stack push and pop correctly tracks navigation history and root return", () => {
    let stack = [];
    const pushLink = (url) => {
      stack = [...stack, { id: `id_${stack.length}`, initialUrl: url, currentUrl: url }];
    };
    const popLink = () => {
      if (stack.length > 0) stack = stack.slice(0, -1);
    };
    const getCurrent = () => (stack.length > 0 ? stack[stack.length - 1] : null);

    expect(getCurrent()).toBeNull();

    pushLink("https://docs.synthetic.org/page1");
    expect(getCurrent()?.initialUrl).toBe("https://docs.synthetic.org/page1");
    expect(getCurrent()?.currentUrl).toBe("https://docs.synthetic.org/page1");

    pushLink("https://docs.synthetic.org/page2");
    expect(getCurrent()?.initialUrl).toBe("https://docs.synthetic.org/page2");
    expect(getCurrent()?.currentUrl).toBe("https://docs.synthetic.org/page2");

    popLink();
    expect(getCurrent()?.initialUrl).toBe("https://docs.synthetic.org/page1");

    popLink();
    expect(getCurrent()).toBeNull();
  });

  test("initialUrl remains stable when currentUrl updates on navigation to prevent iframe reload loops", () => {
    let stack = [
      {
        id: "link_test_1",
        initialUrl: "https://auth.synthetic.ru/login",
        currentUrl: "https://auth.synthetic.ru/login",
      },
    ];

    const onPageNavigated = (newUrl) => {
      if (stack.length > 0) {
        const lastIdx = stack.length - 1;
        if (stack[lastIdx].currentUrl !== newUrl) {
          stack[lastIdx] = {
            ...stack[lastIdx],
            currentUrl: newUrl,
          };
          stack = [...stack];
        }
      }
    };

    onPageNavigated("https://auth.synthetic.ru/login/step2");
    expect(stack[0].initialUrl).toBe("https://auth.synthetic.ru/login");
    expect(stack[0].currentUrl).toBe("https://auth.synthetic.ru/login/step2");
    expect(stack[0].id).toBe("link_test_1");

    onPageNavigated("https://auth.synthetic.ru/login/success");
    expect(stack[0].initialUrl).toBe("https://auth.synthetic.ru/login");
    expect(stack[0].currentUrl).toBe("https://auth.synthetic.ru/login/success");
    expect(stack[0].id).toBe("link_test_1");
  });

  test("normalizes proxy URLs to extract target query parameter", () => {
    const normalizeExternalUrl = (raw) => {
      if (!raw || typeof raw !== "string") return "";
      let clean = raw.trim();
      if (clean.includes("127.0.0.1:11448/proxy") || clean.includes("localhost:11448/proxy")) {
        try {
          const u = new URL(clean);
          const extracted = u.searchParams.get("url") || u.searchParams.get("target");
          if (extracted) clean = extracted;
        } catch {}
      }
      return clean;
    };

    expect(normalizeExternalUrl("http://127.0.0.1:11448/proxy?url=https%3A%2F%2Ffrontend.synthetic.test%2Forganizations%2Fsearch")).toBe("https://frontend.synthetic.test/organizations/search");
    expect(normalizeExternalUrl("http://localhost:11448/proxy?target=https%3A%2F%2Fsynthetic.test%2Fdemo")).toBe("https://synthetic.test/demo");
    expect(normalizeExternalUrl("https://direct-target.synthetic.test/page")).toBe("https://direct-target.synthetic.test/page");
    expect(normalizeExternalUrl("")).toBe("");
    expect(normalizeExternalUrl(null)).toBe("");
  });

  test("ignores open link request if current inner iframe is already displaying that URL", () => {
    let openedLinksStack = [
      {
        id: "link_1",
        initialUrl: "https://auth.synthetic.test",
        currentUrl: "https://auth.synthetic.test",
      },
    ];

    const handleOpenTargetUrl = (url) => {
      if (openedLinksStack.length > 0) {
        const top = openedLinksStack[openedLinksStack.length - 1];
        if (top.initialUrl === url || top.currentUrl === url) {
          return;
        }
      }
      openedLinksStack = [
        ...openedLinksStack,
        { id: `link_${openedLinksStack.length + 1}`, initialUrl: url, currentUrl: url },
      ];
    };

    handleOpenTargetUrl("https://auth.synthetic.test");
    expect(openedLinksStack.length).toBe(1);

    handleOpenTargetUrl("https://auth.synthetic.test/oauth/api/login");
    expect(openedLinksStack.length).toBe(2);
  });

  test("cookie cleaning normalizes path, strips domain and secure, and applies SameSite Lax", () => {
    const cleanSetCookie = (raw) => {
      const reDom = /\bDomain=[^;]+;?\s*/gi;
      const reSec = /\bSecure;?\s*/gi;
      const rePath = /\bPath=[^;]+;?\s*/gi;
      const reSame = /\bSameSite=[^;]+;?\s*/gi;

      let cleaned = raw.replace(reDom, "").replace(reSec, "").replace(rePath, "").replace(reSame, "");
      let trimmed = cleaned.trim().replace(/;+$/, "").trim();
      return `${trimmed}; Path=/; SameSite=Lax`;
    };

    expect(cleanSetCookie("token=synth123; Path=/oauth; Domain=.synthetic.test; Secure; HttpOnly; SameSite=None"))
      .toBe("token=synth123; HttpOnly; Path=/; SameSite=Lax");
    expect(cleanSetCookie("session=abc_987; Path=/; Secure; SameSite=Strict"))
      .toBe("session=abc_987; Path=/; SameSite=Lax");
    expect(cleanSetCookie("simple_id=42"))
      .toBe("simple_id=42; Path=/; SameSite=Lax");
  });

  test("resolves relative and scheme-relative redirect locations to absolute URLs", () => {
    const resolveLocation = (baseUrl, loc) => {
      const trimmed = loc.trim();
      if (trimmed.startsWith("//")) {
        const scheme = baseUrl.startsWith("http://") ? "http:" : "https:";
        return `${scheme}${trimmed}`;
      }
      if (trimmed.startsWith("/")) {
        const u = new URL(baseUrl);
        return `${u.origin}${trimmed}`;
      }
      if (!trimmed.includes("://")) {
        return new URL(trimmed, baseUrl).href;
      }
      return trimmed;
    };

    expect(resolveLocation("https://auth.synthetic.test/login", "/dashboard"))
      .toBe("https://auth.synthetic.test/dashboard");
    expect(resolveLocation("https://auth.synthetic.test/oauth/step1", "step2?client_id=synth"))
      .toBe("https://auth.synthetic.test/oauth/step2?client_id=synth");
    expect(resolveLocation("https://auth.synthetic.test", "//cdn.synthetic.test/lib.js"))
      .toBe("https://cdn.synthetic.test/lib.js");
    expect(resolveLocation("https://auth.synthetic.test", "https://app.synthetic.test/welcome"))
      .toBe("https://app.synthetic.test/welcome");
  });

  test("externalCallback navigates app and resets inner link stack", async () => {
    let app = {
      id: "app_synthetic_1",
      url: "https://miniapp.synthetic.test",
      reloadKey: 0,
    };
    let openedLinksStack = [
      { id: "inner_1", initialUrl: "https://auth.synthetic.test", currentUrl: "https://auth.synthetic.test" }
    ];

    const mockApi = {
      processExternalCallback: async (url) => {
        expect(url).toContain("externalCallback=1");
        return {
          url: "https://miniapp.synthetic.test?authorized=true&synth_token=ok",
        };
      },
    };

    const handleExternalCallbackUrl = async (rawUrl) => {
      const url = rawUrl.trim();
      if (!url) return;
      try {
        const launch = await mockApi.processExternalCallback(url);
        if (launch?.url) {
          app.url = launch.url;
          app.reloadKey += 1;
        }
      } catch (err) {}
      openedLinksStack = [];
    };

    await handleExternalCallbackUrl("https://max.ru/callback?externalCallback=1&code=synth_auth");

    expect(app.url).toBe("https://miniapp.synthetic.test?authorized=true&synth_token=ok");
    expect(app.reloadKey).toBe(1);
    expect(openedLinksStack.length).toBe(0);
  });

  test("external auth URLs route to external browser instead of inner iframe stack", async () => {
    const isExternalAuthUrl = (url) => {
      if (!url || typeof url !== "string") return false;
      const lower = url.toLowerCase();
      return lower.includes("esia.gosuslugi.ru") || lower.includes("gosuslugi.ru");
    };

    let openedInBrowser = [];
    let openedLinksStack = [];

    const handleOpenTargetUrl = async (url) => {
      if (isExternalAuthUrl(url)) {
        openedInBrowser.push(url);
        return;
      }
      openedLinksStack.push({ id: "link_1", initialUrl: url, currentUrl: url });
    };

    await handleOpenTargetUrl("https://esia.gosuslugi.ru/aas/oauth2/ac?client_id=synth");
    expect(openedInBrowser.length).toBe(1);
    expect(openedInBrowser[0]).toBe("https://esia.gosuslugi.ru/aas/oauth2/ac?client_id=synth");
    expect(openedLinksStack.length).toBe(0);

    await handleOpenTargetUrl("https://general.synthetic.test/help");
    expect(openedInBrowser.length).toBe(1);
    expect(openedLinksStack.length).toBe(1);
  });

  test("extractMaxUrlInfo correctly recognizes externalCallback for :current route and max:// scheme", () => {
    const resHttps = extractMaxUrlInfo("https://max.ru/:current?externalCallback=1&type=4&code=synth_code&state=synth_state");
    expect(resHttps).not.toBeNull();
    expect(resHttps?.isMax).toBe(true);
    expect(resHttps?.kind).toBe("external_callback");
    expect(resHttps?.canonicalUrl).toContain("externalCallback=1");

    const resMaxScheme = extractMaxUrlInfo("max://:current?externalCallback=1&type=4&code=synth_code&state=synth_state");
    expect(resMaxScheme).not.toBeNull();
    expect(resMaxScheme?.isMax).toBe(true);
    expect(resMaxScheme?.kind).toBe("external_callback");
  });

  test("processMaxLink processes externalCallback and invokes onLaunchApp with botId and startParam", async () => {
    let launched = null;
    const fakeApi = {
      processExternalCallback: async (url) => {
        expect(url).toContain("externalCallback=1");
        return {
          botId: 8250447,
          url: "https://miniapp.synthetic.test/authenticated",
          startParam: "synth_start_param",
        };
      },
    };

    const handled = await processMaxLink(
      "https://max.ru/:current?externalCallback=1&type=4&code=synth_code&state=synth_state",
      {
        api: fakeApi,
        onLaunchApp: (app) => {
          launched = app;
        },
      }
    );

    expect(handled).toBe(true);
    expect(launched).not.toBeNull();
    expect(launched?.botId).toBe(8250447);
    expect(launched?.url).toBe("https://miniapp.synthetic.test/authenticated");
    expect(launched?.startParam).toBe("synth_start_param");
  });
});
