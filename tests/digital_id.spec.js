import { test, expect } from "@playwright/test";
import {
  parseInitData,
  DOCUMENT_TITLES,
  getStoredBiometryToken,
  saveStoredBiometryToken,
  setApiInvoker,
  resetDigitalIdAuth,
  requestExtApi,
  fetchDigitalIdProfile,
  fetchSecurityStatus,
} from "../src/lib/services/digitalId.js";

test.describe("digital ID service and parsing", () => {
  let mockStore;

  test.beforeAll(() => {
    mockStore = new Map();
    if (typeof globalThis.localStorage === "undefined") {
      globalThis.localStorage = {
        getItem: (k) => mockStore.get(k) ?? null,
        setItem: (k, v) => mockStore.set(k, String(v)),
        removeItem: (k) => mockStore.delete(k),
        clear: () => mockStore.clear(),
      };
    }
  });

  test.beforeEach(() => {
    resetDigitalIdAuth();
    setApiInvoker(null);
    mockStore?.clear?.();
  });

  test("extracts encoded init data from url fragment", () => {
    const syntheticUrl =
      "https://digital-id.synthetic.test/#WebAppData=query_id%3Dsynth_123%26user%3D%257B%2522id%2522%253A999%257D%26hash%3Dabc";
    const parsed = parseInitData(syntheticUrl);
    expect(parsed).toBe("query_id=synth_123&user=%7B%22id%22%3A999%7D&hash=abc");
  });

  test("returns null when WebAppData is absent", () => {
    expect(parseInitData("https://digital-id.synthetic.test/#other=123")).toBeNull();
    expect(parseInitData("https://digital-id.synthetic.test/no-hash")).toBeNull();
    expect(parseInitData("")).toBeNull();
    expect(parseInitData(null)).toBeNull();
  });

  test("contains standard document title mappings", () => {
    expect(DOCUMENT_TITLES.passport).toBe("Паспорт гражданина РФ");
    expect(DOCUMENT_TITLES.driver_license).toBe("Водительское удостоверение");
    expect(DOCUMENT_TITLES.snils).toBe("СНИЛС");
    expect(DOCUMENT_TITLES.inn).toBe("ИНН");
  });

  test("manages biometry token in local storage", () => {
    const syntheticToken = "synth_bio_token_test_abc123";
    const syntheticUser = "999888";
    const syntheticBot = "8250447";

    saveStoredBiometryToken(syntheticToken, syntheticUser, syntheticBot);
    expect(getStoredBiometryToken(syntheticUser, syntheticBot)).toBe(syntheticToken);

    saveStoredBiometryToken(null, syntheticUser, syntheticBot);
    expect(getStoredBiometryToken(syntheticUser, syntheticBot)).toBeNull();
  });

  test("routes ext_api_request through invoker with synthetic headers", async () => {
    let capturedCall = null;
    setApiInvoker(async (command, args) => {
      capturedCall = { command, args };
      return { status: 200, ok: true, data: { status: "ok" } };
    });

    const mockApi = {
      launchDigitalId: async () => ({
        url: "https://digital-id.synthetic.test/#WebAppData=synth_auth_token_999",
      }),
    };

    const resp = await requestExtApi("GET", "/v2/digital-id/biometry-status", {
      apiInstance: mockApi,
    });

    expect(resp.status).toBe(200);
    expect(capturedCall).not.toBeNull();
    expect(capturedCall.command).toBe("ext_api_request");
    expect(capturedCall.args.path).toBe("/v2/digital-id/biometry-status");
    expect(capturedCall.args.headers.Authorization).toBe("#WebAppData=synth_auth_token_999");
  });

  test("fetchDigitalIdProfile returns unlinked when NO_GOSUSLUGI_LINK is received", async () => {
    setApiInvoker(async (command, args) => {
      if (args.path.includes("biometry-status")) {
        return { status: 200, ok: true, data: { data: { has_biometry_token: false } } };
      }
      if (args.path.includes("create-biometry-token")) {
        return { status: 200, ok: true, data: { data: { token: "synth_tok_1" } } };
      }
      if (args.path.includes("refresh-user-docs")) {
        return { status: 200, ok: true, data: { code: "NO_GOSUSLUGI_LINK" } };
      }
      return { status: 200, ok: true, data: {} };
    });

    const mockApi = {
      launchDigitalId: async () => ({
        url: "https://digital-id.synthetic.test/#WebAppData=synth_auth_token_999",
      }),
    };

    const result = await fetchDigitalIdProfile(mockApi, "999888", 8250447);
    expect(result.isLinked).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.documents).toHaveLength(0);
  });

  test("fetchDigitalIdProfile parses profile and documents when linked", async () => {
    setApiInvoker(async (command, args) => {
      if (args.path.includes("biometry-status")) {
        return { status: 200, ok: true, data: { data: { has_biometry_token: true } } };
      }
      if (args.path.includes("create-biometry-token")) {
        return { status: 200, ok: true, data: { data: { token: "synth_tok_2" } } };
      }
      if (args.path.includes("refresh-user-docs")) {
        return { status: 200, ok: true, data: { data: { state: "synth_state_abc" } } };
      }
      if (args.path.includes("get-user-docs")) {
        return {
          status: 200,
          ok: true,
          data: {
            status: "done",
            data: {
              digital_profile: {
                first_name: "Иван",
                last_name: "Иванов",
                snils: "123-456-789 00",
                inn: "123456789012",
                documents: [
                  { type: "passport", fields: { series: "1234", number: "567890" } },
                  { type: "snils", fields: { number: "123-456-789 00" } },
                ],
              },
            },
          },
        };
      }
      if (args.path.includes("get-cards-list")) {
        return {
          status: 200,
          ok: true,
          data: {
            data: {
              acms_cards: [
                { id: "c1", inn: "7700000000", company_name: "Synthetic Org" },
              ],
            },
          },
        };
      }
      return { status: 200, ok: true, data: {} };
    });

    const mockApi = {
      launchDigitalId: async () => ({
        url: "https://digital-id.synthetic.test/#WebAppData=synth_auth_token_999",
      }),
    };

    const result = await fetchDigitalIdProfile(mockApi, "999888", 8250447);
    expect(result.isLinked).toBe(true);
    expect(result.profile?.firstName).toBe("Иван");
    expect(result.profile?.lastName).toBe("Иванов");
    expect(result.profile?.snils).toBe("123-456-789 00");
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0].type).toBe("passport");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].company_name).toBe("Synthetic Org");
  });

  test("fetchSecurityStatus extracts token_level and device_id", async () => {
    setApiInvoker(async (command, args) => {
      if (args.path.includes("security-status")) {
        return {
          status: 200,
          ok: true,
          data: {
            data: {
              token_level: "high",
              device_id: "synth_dev_456",
              attempts_left: 3,
              cooldown: 0,
            },
          },
        };
      }
      return { status: 200, ok: true, data: {} };
    });

    const mockApi = {
      launchDigitalId: async () => ({
        url: "https://digital-id.synthetic.test/#WebAppData=synth_auth_token_999",
      }),
    };

    const status = await fetchSecurityStatus(mockApi);
    expect(status.tokenLevel).toBe("high");
    expect(status.deviceId).toBe("synth_dev_456");
    expect(status.attemptsLeft).toBe(3);
  });

  test("fetchDigitalIdProfile marks isLinked when token_level is high even without documents", async () => {
    setApiInvoker(async (command, args) => {
      if (args.path.includes("security-status")) {
        return { status: 200, ok: true, data: { data: { token_level: "high" } } };
      }
      if (args.path.includes("biometry-status")) {
        return { status: 200, ok: true, data: { data: { has_biometry_token: false } } };
      }
      if (args.path.includes("create-biometry-token")) {
        return { status: 200, ok: true, data: { data: { token: "synth_tok_3" } } };
      }
      if (args.path.includes("refresh-user-docs")) {
        return { status: 200, ok: true, data: { data: { state: "" } } };
      }
      if (args.path.includes("get-cards-list")) {
        return { status: 200, ok: true, data: { data: { acms_cards: [] } } };
      }
      return { status: 200, ok: true, data: {} };
    });

    const mockApi = {
      launchDigitalId: async () => ({
        url: "https://digital-id.synthetic.test/#WebAppData=synth_auth_token_999",
      }),
    };

    const result = await fetchDigitalIdProfile(mockApi, "999888", 8250447);
    expect(result.isLinked).toBe(true);
  });
});
