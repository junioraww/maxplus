import { openUrl } from "@tauri-apps/plugin-opener";
import {
  saveStorageKey,
  getStorageKey,
  clearStorageKeys,
  fetchBiometryStatus,
  requestBiometryAuth,
  updateBiometryTokenValue,
} from "./storage.js";

const METHOD_SLUGS = {
  WebAppSetupBackButton: "setup_back_button",
  WebAppSetupClosingBehavior: "setup_closing_behaviour",
  WebAppBackButtonPressed: "back_button_pressed",
  WebAppSetupScreenCaptureBehavior: "setup_screen_capture_behavior",
  WebAppSetupSwipesBehavior: "setup_swipes_behavior",
  WebAppGetLaunchContext: "get_launch_context",
  WebAppGetViewportSize: "get_viewport_size",
  WebAppRequestPhone: "request_phone",
  WebAppOpenLink: "open_link",
  WebAppOpenMaxLink: "open_max_link",
  WebAppShare: "web_app_share",
  WebAppMaxShare: "web_app_max_share",
  WebAppDeviceStorageSaveKey: "device_storage_save_key",
  WebAppDeviceStorageGetKey: "device_storage_get_key",
  WebAppDeviceStorageClear: "device_storage_clear",
  WebAppSecureStorageSaveKey: "secure_storage_save_key",
  WebAppSecureStorageGetKey: "secure_storage_get_key",
  WebAppSecureStorageClear: "secure_storage_clear",
  WebAppBiometryGetInfo: "biometry_get_info",
  WebAppBiometryRequestAccess: "biometry_request_access",
  WebAppBiometryRequestAuth: "biometry_request_auth",
  WebAppBiometryUpdateToken: "biometry_update_token",
  WebAppBiometryOpenSettings: "biometry_open_settings",
  WebAppHapticFeedbackImpact: "haptic_feedback_impact",
  WebAppHapticFeedbackNotification: "haptic_feedback_notification",
  WebAppHapticFeedbackSelectionChange: "haptic_feedback_selection_change",
  WebAppDownloadFile: "download_file",
  WebAppOpenCodeReader: "open_code_reader",
  WebAppChangeScreenBrightness: "change_screen_brightness",
  WebAppNfcGetInfo: "nfc_get_info",
  WebAppNfcEmulateNfcTag: "nfc_emulate_nfc_tag",
  WebAppNfcOpenSystemSettings: "nfc_open_system_settings",
  WebAppVerifyMobileId: "verify_mobile_id",
  WebAppOrientationLock: "orientation_lock",
  WebAppOrientationUnlock: "orientation_unlock",
};

const METHOD_REVERSE = {
  web_app_ready: "WebAppReady",
  ready: "WebAppReady",
  web_app_close: "WebAppClose",
  close: "WebAppClose",
  web_app_request_viewport: "WebAppGetViewportSize",
  get_viewport_size: "WebAppGetViewportSize",
  web_app_request_theme: "WebAppGetTheme",
  get_theme: "WebAppGetTheme",
  web_app_open_link: "WebAppOpenLink",
  open_link: "WebAppOpenLink",
  open_max_link: "WebAppOpenMaxLink",
  web_app_open_tg_link: "WebAppOpenMaxLink",
  web_app_setup_back_button: "WebAppSetupBackButton",
  setup_back_button: "WebAppSetupBackButton",
  web_app_setup_closing_behavior: "WebAppSetupClosingBehavior",
  setup_closing_behaviour: "WebAppSetupClosingBehavior",
  web_app_request_phone: "WebAppRequestPhone",
  request_phone: "WebAppRequestPhone",
  launch_context: "WebAppGetLaunchContext",
  get_launch_context: "WebAppGetLaunchContext",
  web_app_expand: "WebAppExpand",
  web_app_share: "WebAppShare",
  web_app_max_share: "WebAppMaxShare",
  setup_swipes_behavior: "WebAppSetupSwipesBehavior",
  setup_swipe_behavior: "WebAppSetupSwipesBehavior",
  setup_screen_capture_behavior: "WebAppSetupScreenCaptureBehavior",
  web_app_orientation_lock: "WebAppOrientationLock",
  web_app_orientation_unlock: "WebAppOrientationUnlock",
  orientation_lock: "WebAppOrientationLock",
  orientation_unlock: "WebAppOrientationUnlock",
};

for (const [pascal, slug] of Object.entries(METHOD_SLUGS)) {
  METHOD_REVERSE[slug] = pascal;
  METHOD_REVERSE[slug.replace(/_/g, "")] = pascal;
  METHOD_REVERSE[pascal.toLowerCase()] = pascal;
}

const SILENT_METHODS = new Set([
  "WebAppReady",
  "WebAppStat",
  "WebAppUrlInterceptor",
  "WebAppBackButtonPressed",
]);

function getMethodSlug(method) {
  if (METHOD_SLUGS[method]) return METHOD_SLUGS[method];
  const name = method.replace(/^WebApp/, "");
  return name.replace(/([A-Z])/g, (m, c, offset) => (offset > 0 ? "_" : "") + c.toLowerCase());
}

export function createBridgeClient({
  botId,
  entryPoint = "web_app",
  userId = null,
  deviceId = "",
  getViewportSize = () => ({ width: window.innerWidth, height: window.innerHeight }),
  onClose = () => {},
  onExpand = () => {},
  onBackButtonChange = () => {},
  onClosingBehaviorChange = () => {},
  onPhoneRequested = async () => null,
  onOpenLink = async () => {},
  onDownloadFile = null,
  postToFrame = () => {},
}) {
  let customBackButton = false;
  let closeConfirmation = false;
  let lastGestureTime = 0;

  function markGesture() {
    lastGestureTime = Date.now();
  }

  function hasRecentGesture() {
    return Date.now() - lastGestureTime < 3000;
  }

  function emitToWebApp(method, data = {}, isPrivate = false) {
    const rawRequestId =
      data.requestId !== undefined && data.requestId !== null
        ? data.requestId
        : undefined;

    const enrichedData = {
      ...data,
      ...(rawRequestId !== undefined ? { requestId: rawRequestId } : {}),
    };

    const message = {
      __mpDeliver: true,
      name: method,
      data: JSON.stringify(enrichedData),
      priv: isPrivate,
    };

    postToFrame(JSON.stringify(message));
  }

  function sendOk(method, requestId, status, isPrivate = false) {
    emitToWebApp(
      method,
      {
        status,
        ...(requestId !== undefined && requestId !== null ? { requestId } : {}),
      },
      isPrivate
    );
  }

  function sendError(method, requestId, code, isPrivate = false) {
    if (requestId === undefined || requestId === null) return;
    const slug = getMethodSlug(method);
    emitToWebApp(
      method,
      {
        requestId,
        error: { code: `client.${slug}.${code}` },
      },
      isPrivate
    );
  }

  function normalizeMethod(raw) {
    const m = String(raw || "").trim();
    if (METHOD_SLUGS[m]) return m;
    if (METHOD_REVERSE[m]) return METHOD_REVERSE[m];
    const lower = m.toLowerCase();
    if (METHOD_REVERSE[lower]) return METHOD_REVERSE[lower];
    const stripped = lower.replace(/^web_app_/, "").replace(/^webapp/, "");
    if (METHOD_REVERSE[stripped]) return METHOD_REVERSE[stripped];
    return m;
  }

  async function handleIncomingMessage(rawMethod, rawPayload, isPrivate = false) {
    let payload = {};
    if (typeof rawPayload === "string") {
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        payload = {};
      }
    } else if (rawPayload && typeof rawPayload === "object") {
      payload = rawPayload;
    }

    const requestId =
      payload.requestId !== undefined && payload.requestId !== null
        ? payload.requestId
        : null;
    const method = normalizeMethod(rawMethod);

    switch (method) {
      case "WebAppReady":
      case "WebAppStat":
      case "WebAppUrlInterceptor":
      case "WebAppBackButtonPressed":
        if (requestId !== null) {
          sendOk(method, requestId, "ok", isPrivate);
        }
        break;

      case "WebAppClose":
        onClose();
        break;

      case "WebAppExpand":
        onExpand();
        break;

      case "WebAppSetupBackButton":
        customBackButton = !!payload.isVisible;
        onBackButtonChange(customBackButton);
        break;

      case "WebAppSetupClosingBehavior":
        closeConfirmation = !!payload.needConfirmation;
        onClosingBehaviorChange(closeConfirmation);
        break;

      case "WebAppSetupScreenCaptureBehavior":
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            isScreenCaptureEnabled: !!payload.isScreenCaptureEnabled,
          },
          isPrivate
        );
        break;

      case "WebAppSetupSwipesBehavior":
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            allowVerticalSwipes:
              payload.allowVerticalSwipes !== undefined
                ? !!payload.allowVerticalSwipes
                : payload.allow_vertical_swipe !== undefined
                ? !!payload.allow_vertical_swipe
                : true,
          },
          isPrivate
        );
        break;

      case "WebAppGetLaunchContext":
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            entryPoint: entryPoint || "settings",
            entry_point: entryPoint || "settings",
            launchContext: entryPoint || "settings",
            launch_context: entryPoint || "settings",
            botId: botId ? String(botId) : undefined,
            bot_id: botId ? String(botId) : undefined,
            platform: "android",
            version: "7.0",
          },
          isPrivate
        );
        break;

      case "WebAppGetViewportSize": {
        const vp = getViewportSize();
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            height: Math.round(vp.height),
            width: Math.round(vp.width),
            isStateStable: true,
            is_state_stable: true,
            is_expanded: false,
          },
          isPrivate
        );
        break;
      }

      case "WebAppGetTheme":
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            theme_params: {
              bg_color: "#ffffff",
              text_color: "#000000",
              hint_color: "#999999",
              link_color: "#2481cc",
              button_color: "#2481cc",
              button_text_color: "#ffffff",
              secondary_bg_color: "#f4f4f5",
            },
          },
          isPrivate
        );
        break;

      case "WebAppRequestPhone": {
        try {
          const res = await onPhoneRequested(botId);
          if (res) {
            emitToWebApp(
              method,
              {
                ...(requestId !== null ? { requestId } : {}),
                phone: res.phone,
                hash: res.hash,
                authDate: res.authDate,
              },
              isPrivate
            );
          } else {
            sendError(method, requestId, "user_refused_provide_phone_number", isPrivate);
          }
        } catch {
          sendError(method, requestId, "request_error", isPrivate);
        }
        break;
      }

      case "WebAppOpenLink":
      case "WebAppOpenMaxLink": {
        const url = payload.url;
        if (url) {
          if (typeof onOpenLink === "function") {
            onOpenLink(url);
          } else {
            try {
              await openUrl(url);
            } catch {
              window.open(url, "_blank");
            }
          }
        }
        break;
      }

      case "WebAppShare":
      case "WebAppMaxShare": {
        const text = [payload.text, payload.link].filter(Boolean).join("\n");
        if (navigator.share && text) {
          try {
            await navigator.share({ text });
            sendOk(method, requestId, "shared", isPrivate);
          } catch {
            sendOk(method, requestId, "cancelled", isPrivate);
          }
        } else if (text) {
          try {
            await navigator.clipboard.writeText(text);
            sendOk(method, requestId, "shared", isPrivate);
          } catch {
            sendError(method, requestId, "invalid_request", isPrivate);
          }
        } else {
          sendError(method, requestId, "invalid_request", isPrivate);
        }
        break;
      }

      case "WebAppDeviceStorageSaveKey":
      case "WebAppSecureStorageSaveKey": {
        const isSec = method.startsWith("WebAppSecure");
        const key = payload.key;
        const val = payload.value;
        const saved = await saveStorageKey(userId, botId, isSec, key, val);
        if (saved) {
          sendOk(method, requestId, val === null || val === undefined ? "removed" : "updated", isPrivate);
        } else {
          sendError(method, requestId, "too_many_keys", isPrivate);
        }
        break;
      }

      case "WebAppDeviceStorageGetKey":
      case "WebAppSecureStorageGetKey": {
        const isSec = method.startsWith("WebAppSecure");
        const key = payload.key;
        if (!key) {
          sendError(method, requestId, "invalid_request", isPrivate);
          break;
        }
        const value = await getStorageKey(userId, botId, isSec, key);
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            key,
            value: value !== undefined && value !== null ? value : null,
          },
          isPrivate
        );
        break;
      }

      case "WebAppDeviceStorageClear":
      case "WebAppSecureStorageClear": {
        const isSec = method.startsWith("WebAppSecure");
        await clearStorageKeys(userId, botId, isSec);
        sendOk(method, requestId, "cleared", isPrivate);
        break;
      }

      case "WebAppBiometryGetInfo": {
        const info = await fetchBiometryStatus(userId, botId, deviceId);
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            ...info,
          },
          isPrivate
        );
        break;
      }

      case "WebAppBiometryRequestAccess": {
        const info = await fetchBiometryStatus(userId, botId, deviceId);
        info.accessRequested = true;
        info.accessGranted = true;
        info.access_requested = true;
        info.access_granted = true;
        const auth = await requestBiometryAuth(userId, botId);
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            ...info,
            ...auth,
          },
          isPrivate
        );
        break;
      }

      case "WebAppBiometryRequestAuth": {
        const auth = await requestBiometryAuth(userId, botId);
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            ...auth,
          },
          isPrivate
        );
        break;
      }

      case "WebAppBiometryUpdateToken": {
        const token = payload.token;
        const result = await updateBiometryTokenValue(userId, botId, token);
        if (result.status) {
          sendOk(method, requestId, result.status, isPrivate);
        } else {
          sendError(method, requestId, result.error || "failed", isPrivate);
        }
        break;
      }

      case "WebAppBiometryOpenSettings":
        sendOk(method, requestId, "opened", isPrivate);
        break;

      case "WebAppHapticFeedbackImpact": {
        const style = payload.impactStyle;
        const duration = style === "heavy" ? 25 : style === "medium" ? 15 : 10;
        try {
          navigator.vibrate?.(duration);
        } catch {}
        sendOk(method, requestId, "impactOccured", isPrivate);
        break;
      }

      case "WebAppHapticFeedbackNotification": {
        const type = payload.notificationType;
        const pattern = type === "error" ? [30, 40, 30] : [15, 30, 15];
        try {
          navigator.vibrate?.(pattern);
        } catch {}
        sendOk(method, requestId, "notificationOccured", isPrivate);
        break;
      }

      case "WebAppHapticFeedbackSelectionChange":
        try {
          navigator.vibrate?.(5);
        } catch {}
        sendOk(method, requestId, "selectionChanged", isPrivate);
        break;

      case "WebAppNfcGetInfo":
        emitToWebApp(
          method,
          {
            ...(requestId !== null ? { requestId } : {}),
            available: false,
            enabled: false,
          },
          isPrivate
        );
        break;

      case "WebAppVerifyMobileId": {
        const verifyUrl = payload.url;
        if (!verifyUrl) {
          sendError(method, requestId, "not_supported", isPrivate);
          return;
        }
        try {
          const res = await fetch(verifyUrl);
          const text = await res.text();
          emitToWebApp(
            method,
            {
              ...(requestId !== null ? { requestId } : {}),
              statusCode: res.status,
              headers: {},
              data: btoa(text),
            },
            isPrivate
          );
        } catch {
          sendError(method, requestId, "request_error", isPrivate);
        }
        break;
      }

      case "WebAppOrientationLock":
      case "WebAppOrientationUnlock":
        sendOk(method, requestId, "ok", isPrivate);
        break;

      case "WebAppDownloadFile": {
        const fileUrl = payload.url;
        if (fileUrl) {
          try {
            if (typeof onDownloadFile === "function") {
              await onDownloadFile(fileUrl, payload.fileName || payload.file_name);
              sendOk(method, requestId, "downloading", isPrivate);
            } else {
              try {
                await openUrl(fileUrl);
                sendOk(method, requestId, "downloading", isPrivate);
              } catch {
                if (typeof window !== "undefined" && typeof window.open === "function") {
                  window.open(fileUrl, "_blank");
                  sendOk(method, requestId, "downloading", isPrivate);
                } else {
                  sendError(method, requestId, "failed", isPrivate);
                }
              }
            }
          } catch {
            sendError(method, requestId, "failed", isPrivate);
          }
        } else {
          sendError(method, requestId, "invalid_request", isPrivate);
        }
        break;
      }

      case "WebAppOpenCodeReader":
      case "WebAppChangeScreenBrightness":
      case "WebAppNfcEmulateNfcTag":
      case "WebAppNfcOpenSystemSettings":
        sendError(method, requestId, "not_supported", isPrivate);
        break;

      default:
        if (SILENT_METHODS.has(method)) break;
        sendError(method, requestId, "unsupported_method", isPrivate);
        break;
    }
  }

  function triggerBackPressed() {
    emitToWebApp("WebAppBackButtonPressed", {});
  }

  return {
    markGesture,
    hasRecentGesture,
    handleIncomingMessage,
    triggerBackPressed,
    emitToWebApp,
    get customBackButton() {
      return customBackButton;
    },
    get closeConfirmation() {
      return closeConfirmation;
    },
  };
}
