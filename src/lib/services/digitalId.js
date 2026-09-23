import { invoke as defaultInvoke } from "@tauri-apps/api/core";

let invokeHandler = defaultInvoke;

export function setApiInvoker(fn) {
  invokeHandler = fn || defaultInvoke;
}

let activeAuthHeader = null;
let authHeaderExpiry = 0;

export const DOCUMENT_TITLES = {
  passport: "Паспорт гражданина РФ",
  oms: "Полис ОМС",
  inn: "ИНН",
  driver_license: "Водительское удостоверение",
  vehicle_sts: "СТС",
  snils: "СНИЛС",
  child_birth_cert: "Свидетельство о рождении",
  pension_cert: "Пенсионное удостоверение",
  disabled_cert: "Справка об инвалидности",
  large_family_cert: "Удостоверение многодетной семьи",
  student_ticket: "Студенческий билет",
  child_inn: "ИНН ребёнка",
  child_oms: "Полис ОМС ребёнка",
};

export function parseInitData(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const hashPos = rawUrl.indexOf("#");
  if (hashPos < 0) return null;
  const fragment = rawUrl.slice(hashPos + 1);
  try {
    const params = new URLSearchParams(fragment);
    const data = params.get("WebAppData") || params.get("tgWebAppData");
    if (data) {
      return data;
    }
  } catch {}
  const matched = fragment.match(/(?:tg)?WebAppData=([^&]+)/);
  if (matched?.[1]) {
    try {
      return decodeURIComponent(matched[1]);
    } catch {
      return matched[1];
    }
  }
  return null;
}

export function resetDigitalIdAuth() {
  activeAuthHeader = null;
  authHeaderExpiry = 0;
}

export async function resolveAuthHeader(apiInstance, force = false) {
  if (!force && activeAuthHeader && Date.now() < authHeaderExpiry) {
    return activeAuthHeader;
  }
  if (!apiInstance || typeof apiInstance.launchDigitalId !== "function") {
    return activeAuthHeader;
  }
  const launch = await apiInstance.launchDigitalId();
  const token = parseInitData(launch?.url);
  if (!token) return activeAuthHeader;
  activeAuthHeader = `#WebAppData=${token}`;
  authHeaderExpiry = Date.now() + 10 * 60 * 1000;
  return activeAuthHeader;
}

export async function requestExtApi(method, path, options = {}) {
  const { body = null, headers = {}, apiInstance = null, allowRetry = true } = options;
  const auth = apiInstance
    ? await resolveAuthHeader(apiInstance)
    : activeAuthHeader;

  const reqHeaders = {
    Accept: "application/json",
    Origin: "https://digital-id.max.ru",
    Referer: "https://digital-id.max.ru/",
    "x-requested-with": "ru.oneme.app",
    ...(auth ? { Authorization: auth } : {}),
    ...headers,
  };

  const response = await invokeHandler("ext_api_request", {
    method,
    path,
    headers: reqHeaders,
    body,
  });

  if (response?.status === 401 && allowRetry && apiInstance) {
    resetDigitalIdAuth();
    const freshAuth = await resolveAuthHeader(apiInstance, true);
    reqHeaders.Authorization = freshAuth;
    return await invokeHandler("ext_api_request", {
      method,
      path,
      headers: reqHeaders,
      body,
    });
  }

  return response;
}

export async function resolveSessionDeviceId() {
  try {
    const dev = await invokeHandler("get_device");
    if (dev?.deviceId) return dev.deviceId;
  } catch {}
  try {
    const direct = localStorage.getItem("max_device_id");
    if (direct) return direct;
  } catch {}
  return getAppDeviceId();
}

export function getAppDeviceId() {
  let devId = "";
  try {
    devId = localStorage.getItem("max_device_id") || "";
    if (!devId) {
      devId = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem("max_device_id", devId);
    }
  } catch {}
  return devId;
}

export function getStoredBiometryToken(userId, botId) {
  try {
    const direct = localStorage.getItem("digital_id_biometry_token");
    if (direct) return direct;
    if (userId && botId) {
      const bioKey = `max_wa_bio_${userId}_${botId}`;
      const raw = localStorage.getItem(bioKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.token) return parsed.token;
      }
    }
  } catch {}
  return null;
}

export function saveStoredBiometryToken(token, userId, botId) {
  try {
    if (token) {
      localStorage.setItem("digital_id_biometry_token", token);
      if (userId && botId) {
        const bioKey = `max_wa_bio_${userId}_${botId}`;
        const existing = JSON.parse(localStorage.getItem(bioKey) || "{}");
        existing.token = token;
        existing.granted = true;
        localStorage.setItem(bioKey, JSON.stringify(existing));
      }
    } else {
      localStorage.removeItem("digital_id_biometry_token");
      if (userId && botId) {
        localStorage.removeItem(`max_wa_bio_${userId}_${botId}`);
      }
    }
  } catch {}
}

export async function fetchSecurityStatus(apiInstance) {
  const resp = await requestExtApi("GET", "/v3.1/digital-id/security-status", {
    apiInstance,
  });
  const data = resp?.data?.data || resp?.data || {};
  return {
    tokenLevel: data?.token_level || null,
    deviceId: data?.device_id || null,
    attemptsLeft: data?.attempts_left,
    cooldown: data?.cooldown,
  };
}

export async function fetchBiometryStatus(apiInstance) {
  const resp = await requestExtApi("GET", "/v2/digital-id/biometry-status", {
    apiInstance,
  });
  const data = resp?.data?.data || resp?.data || {};
  return {
    hasBiometryToken: !!data?.has_biometry_token,
    deviceId: data?.device_id || null,
    hasPhotoHash: !!data?.has_photo_hash,
  };
}

export async function acquireBiometryToken(apiInstance, userId, botId) {
  const existing = getStoredBiometryToken(userId, botId);
  if (existing) return existing;
  const devId = await resolveSessionDeviceId();
  const resp = await requestExtApi("POST", "/v3/digital-id/create-biometry-token", {
    body: { device_id: devId },
    apiInstance,
  });
  const token = resp?.data?.data?.token || resp?.data?.token || "";
  if (token) {
    saveStoredBiometryToken(token, userId, botId);
  }
  return token;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchDigitalIdProfile(apiInstance, userId, botId) {
  let isLinked = false;
  let profile = null;
  let documents = [];
  let cards = [];
  let error = null;

  try {
    const secStatus = await fetchSecurityStatus(apiInstance);
    if (secStatus.tokenLevel === "high" || secStatus.tokenLevel === "lite") {
      isLinked = true;
    }
  } catch (err) {
    error = err?.message || String(err);
  }

  try {
    const bioStatus = await fetchBiometryStatus(apiInstance);
    if (bioStatus.hasBiometryToken) {
      isLinked = true;
    }
  } catch {}

  try {
    const token = await acquireBiometryToken(apiInstance, userId, botId);
    if (!token) {
      return { isLinked, profile, documents, cards, error: isLinked ? null : error };
    }

    const refreshResp = await requestExtApi("POST", "/v3/digital-id/refresh-user-docs", {
      body: { token },
      apiInstance,
    });

    const refreshData = refreshResp?.data || {};
    const errCode = refreshData?.error?.code || refreshData?.code || (typeof refreshData?.error === "string" ? refreshData.error : null);
    if (errCode === "NO_GOSUSLUGI_LINK") {
      return { isLinked: false, profile: null, documents: [], cards: [], error: null };
    }

    const state = refreshData?.data?.state || refreshData?.state;
    if (state) {
      isLinked = true;
      for (let i = 0; i < 5; i++) {
        await delay(1200);
        const docsResp = await requestExtApi("POST", "/v2/digital-id/get-user-docs", {
          body: { state },
          apiInstance,
        });
        const docsData = docsResp?.data || {};
        if (docsData?.status === "done" && docsData?.data) {
          const fetchedProfile = docsData.data.digital_profile || {};
          profile = {
            firstName: fetchedProfile.first_name || "",
            lastName: fetchedProfile.last_name || "",
            middleName: fetchedProfile.middle_name || "",
            birthDate: fetchedProfile.birth_date || null,
            birthPlace: fetchedProfile.birth_place || null,
            gender: fetchedProfile.gender || null,
            snils: fetchedProfile.snils || null,
            inn: fetchedProfile.inn || null,
            address: fetchedProfile.registration_address?.address || null,
          };
          documents = Array.isArray(fetchedProfile.documents) ? fetchedProfile.documents : [];
          isLinked = true;
          break;
        }
      }
    }
  } catch (err) {
    if (!error) error = err?.message || String(err);
  }

  try {
    const cardsResp = await requestExtApi("GET", "/v2/digital-id/get-cards-list?pass_status=active", {
      apiInstance,
    });
    const rawCards = cardsResp?.data?.data?.acms_cards || cardsResp?.data?.acms_cards;
    if (Array.isArray(rawCards)) {
      cards = rawCards;
      if (cards.length > 0) {
        isLinked = true;
      }
    }
  } catch {}

  return { isLinked, profile, documents, cards, error: isLinked ? null : error };
}

export async function deleteDigitalIdProfile(apiInstance, userId, botId) {
  try {
    await requestExtApi("DELETE", "/v3/digital-id/delete-profile", { apiInstance });
  } finally {
    saveStoredBiometryToken(null, userId, botId);
    resetDigitalIdAuth();
  }
}

export async function requestEsiaLink(apiInstance) {
  const resp = await requestExtApi("GET", "/v2/digital-id/create-esia-link", {
    apiInstance,
  });
  return resp?.data?.data?.url || resp?.data?.url || "";
}
