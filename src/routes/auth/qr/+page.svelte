<script>
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { goto } from "$app/navigation";
  import { set as sessionSet } from "$lib/stores/session.js";
  import API from "$lib/stores/api";
  import { encodeQr } from "$lib/utils/qrcode.js";
  import { generateWebDevice } from "$lib/utils/device.js";
  // 288 GET_QR, 289 GET_QR_STATUS, 291 LOGIN_BY_QR
  const unwrap = (r) => {
    const p = r?.payload ?? r;
    if (p?.error) throw p;
    return p;
  };

  const LOGO = 0.24;
  let qr = null, status = "loading", error = "", timer, alive = true, device;
  const errText = (e) => e?.localizedMessage || e?.message || e?.error || (typeof e === "string" ? e : "Не удалось получить QR-код");

  async function start() {
    clearTimeout(timer); error = ""; status = "loading"; qr = null;
    try {
      device = generateWebDevice();
      await invoke("init", { identity: device });
      const r = unwrap(await invoke("request_qr"));
      if (!r?.qrLink || !r?.trackId) throw r;
      qr = encodeQr(r.qrLink, "H");
      status = "ready";
      poll(r);
    } catch (e) { console.error("GET_QR", e); status = "error"; error = errText(e); }
  }

  function poll(r) {
    const interval = Math.max(1000, r.pollingInterval || 3000);
    const tick = async () => {
      if (!alive) return;
      if (r.expiresAt && Date.now() >= r.expiresAt) return start();
      try {
        const s = unwrap(await invoke("check_qr", { trackId: r.trackId }));
        if (s?.status?.loginAvailable) return finish(r.trackId);
      } catch (e) { console.warn("GET_QR_STATUS", e); }
      timer = setTimeout(tick, interval);
    };
    timer = setTimeout(tick, interval);
  }

  async function finish(trackId) {
    status = "confirming";
    try {
      const resp = unwrap(await invoke("login_by_qr", { trackId }));
      sessionSet("device", device);
      if (resp?.passwordChallenge) {
        sessionSet("challenge", resp.passwordChallenge);
        return goto("/auth/password");
      }
      if (!resp?.tokenAttrs?.LOGIN) throw resp;
      await $API.handleLoginResponse(resp);
      goto("/");
    } catch (e) { console.error("LOGIN_BY_QR", e); status = "error"; error = errText(e); }
  }

  const finder = (x, y, s) => (x < 7 && y < 7) || (x >= s - 7 && y < 7) || (x < 7 && y >= s - 7);
  const inLogo = (x, y, s) => { const h = (s * LOGO) / 2 + 0.5, c = s / 2;
    return Math.abs(x + 0.5 - c) < h && Math.abs(y + 0.5 - c) < h; };

  $: cells = qr ? qr.modules.flatMap((row, y) => row.map((d, x) =>
      d && !finder(x, y, qr.size) && !inLogo(x, y, qr.size) ? [x, y] : null).filter(Boolean)) : [];
  $: finders = qr ? [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]] : [];

  const openDevices = () => sessionSet("devicesPage", true);
  const openDevSettings = () => sessionSet("devSettings", true);

  onMount(start);
  onDestroy(() => { alive = false; clearTimeout(timer); });
</script>

<div class="auth-page">
  <header class="topbar">
    <button class="icon-btn" on:click={openDevices} aria-label="Данные устройства">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19" />
        <path d="M12 2.5c2.6 2.6 4 6 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-6-4-9.5s1.4-6.9 4-9.5z" />
      </svg>
    </button>
    <button class="icon-btn" on:click={openDevSettings} aria-label="Помощь">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9.5" /><path d="M9.4 9.2a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4" />
        <circle cx="12" cy="17.4" r="0.6" fill="currentColor" />
      </svg>
    </button>
  </header>

  <main class="content">
    <div class="qr" class:qr--dim={status !== "ready"}>
      {#if qr}
        <svg viewBox="0 0 {qr.size} {qr.size}" shape-rendering="geometricPrecision">
          {#each cells as [x, y]}<rect x={x + 0.06} y={y + 0.06} width="0.88" height="0.88" rx="0.22" />{/each}
          {#each finders as [fx, fy]}
            <rect x={fx + 0.5} y={fy + 0.5} width="6" height="6" rx="1.7" fill="none" stroke="currentColor" stroke-width="1" />
            <rect x={fx + 2} y={fy + 2} width="3" height="3" rx="0.9" />
          {/each}
        </svg>
        <span class="qr__logo" aria-hidden="true"></span>
      {/if}
      {#if status === "loading" || status === "confirming"}<div class="spinner"></div>{/if}
      {#if status === "error"}<button class="retry" on:click={start}>Обновить QR-код</button>{/if}
    </div>

    <h1>Войдите в MAX по QR-коду</h1>
    <p class="hint">
      {#if status === "confirming"}Подтверждаем вход…
      {:else if error}{error}
      {:else}Наведите камеру на QR-код, чтобы войти<br />в профиль или скачать приложение{/if}
    </p>
  </main>

  <button class="link" on:click={() => goto("/auth/login")}>Войти по номеру телефона</button>
</div>

<style>
  .auth-page { display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box;
    padding: calc(var(--safe-area-top, 0px) + 12px) 20px calc(var(--safe-area-bottom, 0px) + 28px);
    background: var(--bg-surface); color: var(--text-primary); }
  .topbar { display: flex; justify-content: space-between; height: 44px; }
  .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px;
    padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-primary); cursor: pointer; }
  .icon-btn:active { background: var(--bg-surface-2); }
  .content { flex: 1; display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 440px; margin: 0 auto; }
  .qr { position: relative; width: min(56vw, 260px); aspect-ratio: 1; margin-top: 12vh; color: #222; }
  .qr svg { width: 100%; height: 100%; fill: currentColor; transition: opacity .2s; }
  .qr--dim svg { opacity: .25; }
  .qr__logo { position: absolute; left: 50%; top: 50%; width: 20%; height: 20%; transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #3d8bff 0%, #5b4dff 50%, #b03dff 100%);
    -webkit-mask: url("/icons/logo_foreground.svg") center / contain no-repeat;
    mask: url("/icons/logo_foreground.svg") center / contain no-repeat; }
  .spinner { position: absolute; inset: 0; margin: auto; width: 36px; height: 36px; border-radius: 50%;
    border: 3px solid var(--bg-surface-2); border-top-color: var(--accent-primary); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .retry { position: absolute; inset: 0; margin: auto; height: 40px; width: fit-content; padding: 0 16px; border: none;
    border-radius: 12px; background: var(--accent-primary); color: #fff; font-size: 15px; cursor: pointer; }
  h1 { margin: 40px 0 12px; font-size: 24px; font-weight: 700; text-align: center; }
  .hint { margin: 0; font-size: 17px; line-height: 1.4; text-align: center; color: var(--text-secondary, #8a8a93); }
  .link { align-self: center; border: none; background: none; color: var(--accent-primary); font-size: 18px; cursor: pointer; }
</style>
