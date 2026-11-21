import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { showAlert } from "$lib/utils/alert";

const defaultSettings = {
  proxy_type: "none",
  host: "",
  port: 1080,
  username: "",
  password: "",
  proxy_maxplus_site: true,
  vpn_bypass_enabled: false,
};

export const proxyConfig = writable({ ...defaultSettings });
export const proxyLoading = writable(false);
export const vpnStatus = writable({
  is_vpn: false,
  server_detected: false,
  local_detected: false,
  vpn_bypass_supported: false,
  vpn_bypass_active: false,
});
export const vpnWarningDismissed = writable(false);

export async function loadProxyConfig() {
  try {
    proxyLoading.set(true);
    const settings = await invoke("fetch_proxy_config");
    if (settings && typeof settings === "object") {
      proxyConfig.set({
        proxy_type: settings.proxy_type || (settings.protocol === "socks5" ? "socks5" : settings.protocol === "httpconnect" ? "http" : "none"),
        host: settings.host || "",
        port: Number(settings.port) || 1080,
        username: settings.username || "",
        password: settings.password || "",
        proxy_maxplus_site: settings.proxy_maxplus_site !== false,
        vpn_bypass_enabled: Boolean(settings.vpn_bypass_enabled),
      });
    }
  } catch (e) {
    console.error(e);
  } finally {
    proxyLoading.set(false);
  }
}

export async function saveProxyConfig(newSettings) {
  try {
    proxyLoading.set(true);
    const payload = {
      proxy_type: newSettings.proxy_type || "none",
      host: (newSettings.host || "").trim(),
      port: Number(newSettings.port) || 1080,
      username: newSettings.username ? newSettings.username.trim() : null,
      password: newSettings.password ? newSettings.password : null,
      proxy_maxplus_site: newSettings.proxy_maxplus_site !== false,
      vpn_bypass_enabled: Boolean(newSettings.vpn_bypass_enabled),
    };
    await invoke("update_proxy_config", { settings: payload });
    proxyConfig.set(payload);
    showAlert("Настройки прокси сохранены", "Изменения успешно применены");
  } catch (e) {
    showAlert("Ошибка сохранения прокси", e?.message || String(e));
    throw e;
  } finally {
    proxyLoading.set(false);
  }
}

export async function testProxy(settings) {
  try {
    const payload = {
      proxy_type: settings.proxy_type || "none",
      host: (settings.host || "").trim(),
      port: Number(settings.port) || 1080,
      username: settings.username ? settings.username.trim() : null,
      password: settings.password ? settings.password : null,
      proxy_maxplus_site: settings.proxy_maxplus_site !== false,
    };
    return await invoke("ping_proxy_endpoint", { settings: payload });
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

export async function checkVpn() {
  try {
    const res = await invoke("query_vpn_condition");
    if (res && typeof res === "object") {
      vpnStatus.set(res);
      return res;
    }
  } catch (e) {
    console.error(e);
  }
  return get(vpnStatus);
}

export async function toggleVpnBypass(enabled) {
  try {
    const ok = await invoke("switch_vpn_bypass", { enabled: Boolean(enabled) });
    proxyConfig.update(c => ({ ...c, vpn_bypass_enabled: Boolean(enabled) }));
    await checkVpn();
    return ok;
  } catch (e) {
    showAlert("Ошибка переключения обхода VPN", e?.message || String(e));
    throw e;
  }
}
