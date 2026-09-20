import { writable, get } from "svelte/store";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export const webappLogs = writable([]);
export const filterRules = writable([]);

const STORAGE_RULES_KEY = "max_webapp_filter_rules";
const MAX_RAM_LOGS = 1000;

let isInitialized = false;

function loadStoredRules() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_RULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredRules(rules) {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_RULES_KEY, JSON.stringify(rules));
    } catch {}
  }
}

export async function initWebAppLogs() {
  if (isInitialized) return;
  isInitialized = true;

  const initialRules = loadStoredRules();
  filterRules.set(initialRules);

  try {
    await invoke("set_webapp_filter_rules", { rules: initialRules });
  } catch {}

  try {
    const existing = await invoke("get_webapp_ram_logs");
    if (Array.isArray(existing) && existing.length > 0) {
      webappLogs.set(existing.slice(-MAX_RAM_LOGS));
    }
  } catch {}

  try {
    await listen("webapp_network_log", (event) => {
      if (!event.payload) return;
      addWebAppLog(event.payload);
    });
  } catch {}
}

export function addWebAppLog(entry) {
  webappLogs.update((current) => {
    const next = [entry, ...current];
    if (next.length > MAX_RAM_LOGS) {
      return next.slice(0, MAX_RAM_LOGS);
    }
    return next;
  });
}

export async function clearWebAppLogs() {
  webappLogs.set([]);
  try {
    await invoke("clear_webapp_ram_logs");
  } catch {}
}

export async function addFilterRule({ name, pattern, is_regex = false, target = "url" }) {
  const newRule = {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || pattern,
    pattern: pattern.trim(),
    is_regex: !!is_regex,
    target,
    enabled: true,
  };

  filterRules.update((current) => {
    const next = [...current, newRule];
    saveStoredRules(next);
    invoke("set_webapp_filter_rules", { rules: next }).catch(() => {});
    return next;
  });

  return newRule;
}

export async function updateFilterRule(id, fields) {
  filterRules.update((current) => {
    const next = current.map((r) => (r.id === id ? { ...r, ...fields } : r));
    saveStoredRules(next);
    invoke("set_webapp_filter_rules", { rules: next }).catch(() => {});
    return next;
  });
}

export async function removeFilterRule(id) {
  filterRules.update((current) => {
    const next = current.filter((r) => r.id !== id);
    saveStoredRules(next);
    invoke("set_webapp_filter_rules", { rules: next }).catch(() => {});
    return next;
  });
}

export async function toggleFilterRule(id) {
  filterRules.update((current) => {
    const next = current.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    saveStoredRules(next);
    invoke("set_webapp_filter_rules", { rules: next }).catch(() => {});
    return next;
  });
}

async function saveJsonFile(defaultName, payload) {
  const jsonStr = JSON.stringify(payload, null, 2);

  try {
    const path = await save({
      defaultPath: defaultName,
      filters: [
        {
          name: "JSON (*.json)",
          extensions: ["json"],
        },
      ],
    });

    if (path) {
      await invoke("write_file_string", { path, content: jsonStr });
      return { success: true, path };
    }
  } catch {}

  try {
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { success: true, path: defaultName };
  } catch (err) {
    throw new Error("Не удалось сохранить файл");
  }
}

export async function exportServerLogs(logsList) {
  if (!logsList || logsList.length === 0) {
    throw new Error("Нет логов для экспорта");
  }

  const rules = get(filterRules) || [];

  const payload = {
    version: 1,
    type: "server_network_logs",
    exportedAt: new Date().toISOString(),
    total: logsList.length,
    logs: logsList,
    filters: rules,
  };

  return await saveJsonFile(`max_api_logs_${Date.now()}.json`, payload);
}

export async function exportWebAppLogs(logsToExport = null) {
  const list = logsToExport || get(webappLogs);
  if (!list || list.length === 0) {
    throw new Error("Нет логов для экспорта");
  }

  const rules = get(filterRules) || [];

  const payload = {
    version: 1,
    type: "webapp_network_logs",
    exportedAt: new Date().toISOString(),
    total: list.length,
    logs: list,
    filters: rules,
  };

  return await saveJsonFile(`webapp_logs_${Date.now()}.json`, payload);
}

export async function exportFilterRules() {
  const list = get(filterRules);
  if (!list || list.length === 0) {
    throw new Error("Нет правил для экспорта");
  }

  const payload = {
    version: 1,
    type: "webapp_filter_rules",
    exportedAt: new Date().toISOString(),
    total: list.length,
    rules: list,
  };

  return await saveJsonFile(`webapp_filters_${Date.now()}.json`, payload);
}

export async function importFilterRules() {
  const select = await invoke("pick", { type: "JSON" });
  if (!select) return null;

  const data = await invoke("read_file", { path: select.uri });
  const text = new TextDecoder("utf-8").decode(new Uint8Array(data));

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Файл не является корректным JSON");
  }

  let rulesArray = null;
  if (Array.isArray(parsed)) {
    rulesArray = parsed;
  } else if (parsed && Array.isArray(parsed.rules)) {
    rulesArray = parsed.rules;
  }

  if (!rulesArray || rulesArray.length === 0) {
    throw new Error("В файле не найдено правил для импорта");
  }

  const sanitized = rulesArray
    .filter((r) => r && typeof r.pattern === "string" && r.pattern.trim().length > 0)
    .map((r) => ({
      id: r.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: (r.name || r.pattern).trim(),
      pattern: r.pattern.trim(),
      target: ["url", "host", "ip"].includes(r.target) ? r.target : "url",
      is_regex: !!r.is_regex,
      enabled: r.enabled !== false,
    }));

  if (sanitized.length === 0) {
    throw new Error("Нет корректных правил в файле");
  }

  filterRules.update((existing) => {
    const existingIds = new Set(existing.map((x) => x.id));
    const merged = [...existing];
    for (const rule of sanitized) {
      if (existingIds.has(rule.id)) {
        const idx = merged.findIndex((x) => x.id === rule.id);
        if (idx !== -1) merged[idx] = rule;
      } else {
        merged.push(rule);
        existingIds.add(rule.id);
      }
    }
    saveStoredRules(merged);
    invoke("set_webapp_filter_rules", { rules: merged }).catch(() => {});
    return merged;
  });

  return { count: sanitized.length };
}
