<script>
  import { onDestroy } from "svelte";
  import { handleEnc, dismissRequest } from "$components/ChatWindow/e2e";

  export let gotSecretChatRequest = null;
  export let chat = null;
  export let messages = null;
  export let chatSettings = null;
  export let close = null;
  export let setBackHandler = null;

  let handled = false;

  $: if (setBackHandler) {
    setBackHandler(() => {
      handleDismiss();
      return true;
    });
  }

  $: partnerName = chat?.title || "Собеседник";

  async function action(name) {
    if (handled) return;
    handled = true;
    try {
      await handleEnc(chat, chatSettings, messages, name);
    } catch (err) {
      console.error("handleEnc error:", err);
    }
    if (close) close();
  }

  function handleDismiss() {
    if (!handled && gotSecretChatRequest) {
      if (gotSecretChatRequest.messageId || gotSecretChatRequest.handshakeData) {
        dismissRequest(
          chat?.id,
          gotSecretChatRequest.messageId,
          gotSecretChatRequest.handshakeData
        );
      }
    }
  }

  onDestroy(() => {
    handleDismiss();
  });
</script>

<div class="e2e-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="e2e-sheet-title">
  <div class="sheet-drag-handle" aria-hidden="true"></div>

  <div class="shield-badge">
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  </div>

  <h3 id="e2e-sheet-title" class="sheet-title">Секретный чат</h3>
  <p class="sheet-desc">
    {partnerName} предлагает включить сквозное шифрование для защиты вашей переписки
  </p>

  <div class="info-card">
    <div class="info-row">
      <div class="info-icon security">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <div class="info-text">
        <span class="info-label">Сквозное E2E-шифрование</span>
        <span class="info-sub">Сообщения шифруются на устройствах и не могут быть прочитаны на сервере</span>
      </div>
    </div>

    <div class="info-divider"></div>

    <div class="info-row">
      <div class="info-icon warning">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div class="info-text">
        <span class="info-label warning">Внимание к выходу из аккаунта</span>
        <span class="info-sub warning">После выхода из аккаунта или сброса сессии прочесть историю будет невозможно</span>
      </div>
    </div>
  </div>

  <div class="actions">
    <div class="primary-row">
      <button type="button" class="btn btn-secondary" on:click={() => action("deny")}>
        Отказаться
      </button>
      <button type="button" class="btn btn-primary" on:click={() => action("agree")}>
        Согласиться
      </button>
    </div>
    <button type="button" class="btn-snooze" on:click={() => action("block")}>
      Не показывать 5 минут
    </button>
  </div>
</div>

<style>
  .e2e-sheet-panel {
    width: 100%;
    background: var(--bg-surface, #21232c);
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 10px 20px calc(20px + var(--safe-bottom, 0px)) 20px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
    user-select: none;
  }

  .sheet-drag-handle {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.22);
    margin-bottom: 20px;
    flex-shrink: 0;
  }

  .shield-badge {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
    box-shadow: 0 0 24px rgba(34, 197, 94, 0.12);
  }

  .sheet-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary, #ffffff);
    text-align: center;
    letter-spacing: -0.3px;
  }

  .sheet-desc {
    margin: 8px 0 20px 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-secondary, rgba(255, 255, 255, 0.65));
    text-align: center;
    max-width: 360px;
  }

  .info-card {
    width: 100%;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 16px;
    padding: 12px 14px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 22px;
  }

  .info-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .info-icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .info-icon.security {
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
  }

  .info-icon.warning {
    background: rgba(245, 158, 11, 0.14);
    color: #f59e0b;
  }

  .info-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .info-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #ffffff);
  }

  .info-label.warning {
    color: #fbbf24;
  }

  .info-sub {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  }

  .info-sub.warning {
    color: rgba(254, 240, 138, 0.85);
  }

  .info-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 2px 0;
  }

  .actions {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .primary-row {
    width: 100%;
    display: flex;
    gap: 10px;
  }

  .btn {
    flex: 1;
    height: 48px;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, transform 0.1s ease, opacity 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .btn:active {
    transform: scale(0.98);
  }

  .btn.btn-primary {
    background: var(--accent-color, #22c55e);
    color: #ffffff;
  }

  .btn.btn-primary:hover {
    background: #16a34a;
  }

  .btn.btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary, #ffffff);
  }

  .btn.btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .btn-snooze {
    background: transparent;
    border: none;
    color: var(--text-muted, rgba(255, 255, 255, 0.45));
    font-size: 13px;
    font-weight: 500;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .btn-snooze:hover {
    color: var(--text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.05);
  }
</style>
