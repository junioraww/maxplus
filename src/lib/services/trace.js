import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { showAlert } from "../utils/alert.js";

export const isTracing = writable(false);
export const traceSize = writable(0);
export const traceEventCount = writable(0);
export const traceStartTime = writable(null);

let activeEvents = [];
let activeScreenshots = [];
let activeSystemInfo = null;
let currentEstimatedBytes = 0;
let screenshotInterval = null;
let unlisteners = [];
let originalConsoleError = null;
let startTimeEpoch = 0;
let thresholdWarnings = { 100: false, 200: false, 500: false };

const TRIM_KEYS = new Set([
  "baseurl",
  "url",
  "thumbhash",
  "previewdata",
  "callbackdata",
  "id",
  "cid",
  "sender",
  "videoid",
  "token",
  "auth",
  "authorization",
  "password",
  "secret",
  "code",
  "track_id",
  "access_token",
  "refresh_token",
  "hash",
  "salt",
  "key",
  "crypto",
  "aes_key",
  "signature",
  "avatar_token",
  "cookie",
]);

export function sanitizeData(data, depth = 0) {
  if (depth > 8 || data === null || data === undefined) return data;
  if (typeof data === "string") {
    if (data.length > 500) {
      return data.slice(0, 200) + "... [TRIM]";
    }
    if (/^\+?[0-9]{10,15}$/.test(data)) {
      return "[TRIM]";
    }
    return data;
  }
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.slice(0, 50).map((item) => sanitizeData(item, depth + 1));
  }
  const result = {};
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase();
    if (
      TRIM_KEYS.has(lowerKey) ||
      lowerKey.includes("token") ||
      lowerKey.includes("password") ||
      lowerKey.includes("secret")
    ) {
      result[key] = "[TRIM]";
      continue;
    }
    if (lowerKey === "phone" || lowerKey === "phone_number") {
      result[key] = "[TRIM]";
      continue;
    }
    if (lowerKey === "text" || lowerKey === "caption" || lowerKey === "message") {
      result[key] = "[TRIM]";
      continue;
    }
    result[key] = sanitizeData(data[key], depth + 1);
  }
  return result;
}

function checkSizeThresholds(newBytes) {
  currentEstimatedBytes += newBytes;
  traceSize.set(currentEstimatedBytes);

  const mb = currentEstimatedBytes / (1024 * 1024);
  if (mb >= 500 && !thresholdWarnings[500]) {
    thresholdWarnings[500] = true;
    showAlert("Размер логов трейса превысил 500 МБ!", "Рекомендуется остановить запись и сохранить лог.");
    addTraceEvent("Warning", { warning: "Trace size exceeded 500 MB", sizeBytes: currentEstimatedBytes });
  } else if (mb >= 200 && !thresholdWarnings[200]) {
    thresholdWarnings[200] = true;
    showAlert("Размер логов трейса превысил 200 МБ!", "Рекомендуется остановить запись и сохранить лог.");
    addTraceEvent("Warning", { warning: "Trace size exceeded 200 MB", sizeBytes: currentEstimatedBytes });
  } else if (mb >= 100 && !thresholdWarnings[100]) {
    thresholdWarnings[100] = true;
    showAlert("Размер логов трейса превысил 100 МБ!", "Рекомендуется остановить запись и сохранить лог.");
    addTraceEvent("Warning", { warning: "Trace size exceeded 100 MB", sizeBytes: currentEstimatedBytes });
  }
}

export function addTraceEvent(type, payload) {
  if (!get(isTracing)) return;

  const now = Date.now();
  const timeOffsetMs = now - startTimeEpoch;
  const sanitized = sanitizeData(payload);

  const event = {
    id: activeEvents.length + 1,
    timeOffsetMs,
    timestamp: new Date(now).toISOString(),
    type,
    payload: sanitized,
  };

  activeEvents.push(event);
  traceEventCount.set(activeEvents.length);

  const approxSize = JSON.stringify(event).length + 32;
  checkSizeThresholds(approxSize);
}

export function recordApiRequest(command, args) {
  if (!get(isTracing)) return;
  addTraceEvent("Api_Request", { command, args });
}

export function recordApiResponse(command, response, durationMs, error = null) {
  if (!get(isTracing)) return;
  addTraceEvent("Api_Response", {
    command,
    durationMs,
    status: error ? "Error" : "Ok",
    response: error ? error : response,
  });
}

function getElementPath(el) {
  if (!el || !(el instanceof Element)) return "";
  const parts = [];
  let curr = el;
  while (curr && curr !== document.body && curr !== document.documentElement && parts.length < 5) {
    let name = curr.tagName.toLowerCase();
    if (curr.id) {
      name += `#${curr.id}`;
    } else if (curr.className && typeof curr.className === "string") {
      const cls = curr.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (cls) name += `.${cls}`;
    }
    parts.unshift(name);
    curr = curr.parentElement;
  }
  return parts.join(" > ");
}

function handleClick(e) {
  if (!get(isTracing)) return;

  const target = e.target;
  let text = "";
  let tag = "";
  let id = "";
  let className = "";
  let role = "";
  let ariaLabel = "";
  let rect = null;

  if (target instanceof Element) {
    tag = target.tagName.toLowerCase();
    id = target.id || "";
    className = typeof target.className === "string" ? target.className : "";
    role = target.getAttribute("role") || "";
    ariaLabel = target.getAttribute("aria-label") || "";
    text = (target.innerText || target.textContent || "").trim().slice(0, 40);
    const r = target.getBoundingClientRect();
    rect = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  addTraceEvent("Click", {
    x: e.clientX,
    y: e.clientY,
    element: {
      tag,
      id,
      className,
      role,
      ariaLabel,
      text: sanitizeData(text),
      path: getElementPath(target),
      rect,
    },
  });
}

function handleError(e) {
  if (!get(isTracing)) return;
  addTraceEvent("Error", {
    message: e.message || String(e),
    filename: e.filename || "",
    lineno: e.lineno || 0,
    colno: e.colno || 0,
    stack: e.error?.stack || "",
  });
}

function handleUnhandledRejection(e) {
  if (!get(isTracing)) return;
  const reason = e.reason;
  addTraceEvent("Unhandled_Rejection", {
    message: reason?.message || String(reason),
    stack: reason?.stack || "",
  });
}

async function collectSystemInfo() {
  let backendInfo = {};
  try {
    backendInfo = await invoke("get_system_trace_info");
  } catch (err) {
    backendInfo = { error: String(err) };
  }

  let gpuRenderer = "Unknown";
  let gpuVendor = "Unknown";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || "Unknown";
        gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "Unknown";
      }
    }
  } catch {}

  const screenInfo = {
    width: window.screen.width,
    height: window.screen.height,
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    colorDepth: window.screen.colorDepth || 24,
  };

  const navInfo = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages || [],
    onLine: navigator.onLine,
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
    deviceMemory: navigator.deviceMemory || null,
    connection: navigator.connection
      ? {
          effectiveType: navigator.connection.effectiveType,
          downlink: navigator.connection.downlink,
          rtt: navigator.connection.rtt,
        }
      : null,
  };

  const timeZoneInfo = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMinutes: new Date().getTimezoneOffset(),
  };

  let currentDevice = {};
  try {
    currentDevice = sanitizeData(await invoke("get_device"));
  } catch {}

  return {
    ...backendInfo,
    gpu: {
      vendor: gpuVendor,
      renderer: gpuRenderer,
    },
    screen: screenInfo,
    browser: navInfo,
    timeZone: timeZoneInfo,
    configuredDevice: currentDevice,
  };
}

async function captureMiniScreenshot(targetWidth = 128, targetHeight = 64) {
  try {
    const winW = window.innerWidth || 800;
    const winH = window.innerHeight || 600;
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script, iframe, noscript, audio, video").forEach((el) => el.remove());

    clone.querySelectorAll("img").forEach((img) => {
      if (img.src && !img.src.startsWith("data:image/svg+xml")) {
        img.src = "";
        img.style.visibility = "hidden";
      }
    });

    const bodyBg = window.getComputedStyle(document.body).backgroundColor || "#18181c";
    clone.style.backgroundColor = bodyBg;

    const xml = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${winW}" height="${winH}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = new Image();

    const dataUrl = await new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          URL.revokeObjectURL(url);
          resolve(null);
        }
      }, 1200);

      img.onload = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/jpeg", 0.5));
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };

      img.onerror = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(null);
      };

      img.src = url;
    });

    if (dataUrl) {
      const base64Data = dataUrl.split(",")[1];
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return { dataUrl, bytes };
    }
  } catch {}

  return null;
}

async function takePeriodicScreenshot() {
  if (!get(isTracing)) return;
  const result = await captureMiniScreenshot(128, 64);
  if (!result) return;

  const count = activeScreenshots.length + 1;
  const now = Date.now();
  const timeOffsetMs = now - startTimeEpoch;
  const sec = Math.floor(timeOffsetMs / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  const filename = `screen_${String(count).padStart(3, "0")}_${min}m${remSec}s.jpg`;

  activeScreenshots.push({
    id: count,
    filename,
    timeOffsetMs,
    timestamp: new Date(now).toISOString(),
    bytes: result.bytes,
  });

  addTraceEvent("Screenshot", {
    id: count,
    filename,
    resolution: "128x64",
    byteSize: result.bytes.length,
  });

  checkSizeThresholds(result.bytes.length);
}

export async function startTrace() {
  if (get(isTracing)) return;

  activeEvents = [];
  activeScreenshots = [];
  currentEstimatedBytes = 0;
  thresholdWarnings = { 100: false, 200: false, 500: false };
  startTimeEpoch = Date.now();

  traceStartTime.set(startTimeEpoch);
  traceEventCount.set(0);
  traceSize.set(0);
  isTracing.set(true);

  activeSystemInfo = await collectSystemInfo();
  addTraceEvent("System", activeSystemInfo);

  document.addEventListener("click", handleClick, true);
  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);

  originalConsoleError = console.error;
  console.error = (...args) => {
    try {
      if (get(isTracing)) {
        addTraceEvent("Console_Error", {
          args: args.map((a) => (typeof a === "object" ? sanitizeData(a) : String(a))),
        });
      }
    } catch {}
    originalConsoleError.apply(console, args);
  };

  try {
    const unlistenMax = await listen("max", (e) => {
      if (get(isTracing) && e.payload) {
        addTraceEvent("Max_Event", e.payload);
      }
    });
    unlisteners.push(unlistenMax);
  } catch {}

  try {
    const unlistenWebapp = await listen("webapp_network_log", (e) => {
      if (get(isTracing) && e.payload) {
        addTraceEvent("Webapp_Net", e.payload);
      }
    });
    unlisteners.push(unlistenWebapp);
  } catch {}

  await takePeriodicScreenshot();
  screenshotInterval = setInterval(takePeriodicScreenshot, 10000);

  showAlert("Запись трейса запущена", "Для завершения нажмите на красную кнопку.");
}

function formatReadableTimeline(events, sysInfo, startTime, stopTime) {
  const lines = [];
  lines.push("================================================================================");
  lines.push("Max+ Client Trace Log");
  lines.push(`Start time:  ${new Date(startTime).toISOString()}`);
  lines.push(`Stop time:   ${new Date(stopTime).toISOString()}`);
  lines.push(`Duration:    ${Math.round((stopTime - startTime) / 1000)}s`);
  lines.push(`App version: ${sysInfo?.app_version || "Unknown"}`);
  lines.push(`OS:          ${sysInfo?.os || "Unknown"} (${sysInfo?.arch || "Unknown"})`);
  lines.push(`CPU cores:   ${sysInfo?.cpu_cores || "Unknown"}`);
  lines.push(`GPU:         ${sysInfo?.gpu?.renderer || "Unknown"}`);
  lines.push(`Screen:      ${sysInfo?.screen?.width}x${sysInfo?.screen?.height}@${sysInfo?.screen?.devicePixelRatio}x`);
  lines.push(`Local IP:    ${sysInfo?.local_ip || "Unknown"}`);
  lines.push(`Public IP:   ${sysInfo?.public_ip || "Unknown"}`);
  lines.push("================================================================================\n");

  for (const ev of events) {
    const totalMs = ev.timeOffsetMs || 0;
    const mins = String(Math.floor(totalMs / 60000)).padStart(2, "0");
    const secs = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, "0");
    const ms = String(totalMs % 1000).padStart(3, "0");
    const timeTag = `[+${mins}:${secs}.${ms}]`;

    switch (ev.type) {
      case "Click": {
        const p = ev.payload;
        const el = p.element || {};
        lines.push(`${timeTag} [Click] (${p.x}, ${p.y}) <${el.tag}${el.className ? "." + el.className.split(" ")[0] : ""}> "${el.text || ""}" at path: ${el.path || ""}`);
        break;
      }
      case "Api_Request": {
        const p = ev.payload;
        lines.push(`${timeTag} [Api_Request] invoke: ${p.command} args: ${JSON.stringify(p.args)}`);
        break;
      }
      case "Api_Response": {
        const p = ev.payload;
        lines.push(`${timeTag} [Api_Response] invoke: ${p.command} (${p.durationMs}ms) status: ${p.status}`);
        break;
      }
      case "Webapp_Net": {
        const p = ev.payload;
        lines.push(`${timeTag} [Webapp_Net] ${p.method} ${p.url} -> ${p.status} ${p.status_text || ""} (${p.duration_ms || 0}ms)`);
        break;
      }
      case "Max_Event": {
        const p = ev.payload;
        const opcode = p?.opcode || p?.type || p?.action || "Event";
        lines.push(`${timeTag} [Max_Event] opcode: ${opcode} payload: ${JSON.stringify(p)}`);
        break;
      }
      case "Screenshot": {
        const p = ev.payload;
        lines.push(`${timeTag} [Screenshot] ${p.filename} (${p.resolution})`);
        break;
      }
      case "Error":
      case "Unhandled_Rejection":
      case "Console_Error": {
        lines.push(`${timeTag} [Error] ${ev.type}: ${JSON.stringify(ev.payload)}`);
        break;
      }
      default: {
        lines.push(`${timeTag} [${ev.type}] ${JSON.stringify(ev.payload)}`);
        break;
      }
    }
  }

  return lines.join("\n");
}

export async function stopTraceAndExport() {
  if (!get(isTracing)) return;

  isTracing.set(false);
  const stopTimeEpoch = Date.now();

  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }

  document.removeEventListener("click", handleClick, true);
  window.removeEventListener("error", handleError);
  window.removeEventListener("unhandledrejection", handleUnhandledRejection);

  if (originalConsoleError) {
    console.error = originalConsoleError;
    originalConsoleError = null;
  }

  for (const unlisten of unlisteners) {
    try {
      unlisten();
    } catch {}
  }
  unlisteners = [];

  addTraceEvent("Stop", {
    durationMs: stopTimeEpoch - startTimeEpoch,
    totalEvents: activeEvents.length,
    totalScreenshots: activeScreenshots.length,
  });

  const appVersion = activeSystemInfo?.app_version || "0.1.3";
  const vVersion = appVersion.startsWith("v") ? appVersion : `v${appVersion}`;
  const dateStr = new Date(stopTimeEpoch).toISOString().replace(/[:.]/g, "-");
  const zipFileName = `log-${vVersion}-${dateStr}.zip`;

  const readableTimeline = formatReadableTimeline(activeEvents, activeSystemInfo, startTimeEpoch, stopTimeEpoch);

  const encoder = new TextEncoder();
  const zipFiles = {
    "log.txt": Array.from(encoder.encode(readableTimeline)),
  };

  for (const s of activeScreenshots) {
    zipFiles[`screenshots/${s.filename}`] = Array.from(s.bytes);
  }

  let savedLocation = null;
  try {
    savedLocation = await invoke("save_trace_archive", {
      name: zipFileName,
      files: zipFiles,
    });
  } catch (err) {
    showAlert("Ошибка создания архива", String(err));
    return;
  }

  if (savedLocation) {
    showAlert("Трейс успешно сохранен!", savedLocation);
  }
}
