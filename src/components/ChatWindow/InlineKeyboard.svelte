<script>
  import { openUrl } from "@tauri-apps/plugin-opener";
  import API from "$lib/stores/api";

  let { chat, msg, attach } = $props();

  let loadingKey = $state(null);

  function getKeyboardRows(att) {
    if (!att) return [];
    if (Array.isArray(att.rows)) return att.rows;
    if (att.keyboard && Array.isArray(att.keyboard.buttons)) {
      return att.keyboard.buttons;
    }
    if (Array.isArray(att.buttons)) {
      return att.buttons;
    }
    return [];
  }

  let rows = $derived(getKeyboardRows(attach));
  let callbackId = $derived(attach?.callbackId || "");

  async function handleButtonClick(button, rowIdx, colIdx) {
    const bType = (button.type || button.buttonType || "").toUpperCase();
    const key = `${rowIdx}_${colIdx}`;

    if (bType === "LINK") {
      const url = button.url;
      if (url) {
        try {
          await openUrl(url);
        } catch {
          window.open(url, "_blank");
        }
      }
      return;
    }

    if (bType === "CLIPBOARD") {
      const payload = button.payload || "";
      if (payload) {
        try {
          await navigator.clipboard.writeText(payload);
          alert("Скопировано");
        } catch (e) {
          console.error("Clipboard error:", e);
        }
      }
      return;
    }

    if (bType === "OPEN_APP") {
      const url = button.webApp || button.url || button.payload;
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        try {
          await openUrl(url);
        } catch {
          window.open(url, "_blank");
        }
      } else {
        alert("Приложение: " + (button.text || ""));
      }
      return;
    }

    if (loadingKey) return;
    loadingKey = key;

    try {
      const resp = await $API.sendButtonCallback(
        chat.id,
        msg.id,
        callbackId,
        button.payload
      );

      if (resp) {
        const payload = resp.payload || resp;
        const url = payload.url;
        if (url) {
          try {
            await openUrl(url);
          } catch {
            window.open(url, "_blank");
          }
          return;
        }
        const text = payload.text;
        if (text) {
          alert(text);
        }
      }
    } catch (e) {
      console.error("Callback error:", e);
    } finally {
      loadingKey = null;
    }
  }
</script>

{#if rows && rows.length > 0}
  <div class="inline-keyboard">
    {#each rows as row, rowIdx}
      <div class="keyboard-row">
        {#each row as button, colIdx}
          {@const bType = (button.type || button.buttonType || "").toUpperCase()}
          {@const isCurrentLoading = loadingKey === `${rowIdx}_${colIdx}`}
          <button
            type="button"
            class="inline-btn"
            class:loading={isCurrentLoading}
            disabled={isCurrentLoading}
            onclick={(e) => {
              e.stopPropagation();
              handleButtonClick(button, rowIdx, colIdx);
            }}
          >
            {#if isCurrentLoading}
              <span class="btn-spinner"></span>
            {:else}
              <span class="btn-text">{button.text}</span>
              {#if bType === "LINK"}
                <svg class="btn-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              {:else if bType === "CLIPBOARD"}
                <svg class="btn-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              {:else if bType === "OPEN_APP"}
                <svg class="btn-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              {/if}
            {/if}
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .inline-keyboard {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-top: 5px;
    box-sizing: border-box;
  }

  .keyboard-row {
    display: flex;
    flex-direction: row;
    gap: 4px;
    width: 100%;
  }

  .inline-btn {
    flex: 1 1 0;
    min-width: 0;
    min-height: 34px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.12);
    border: none;
    border-radius: 8px;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    transition: background-color 0.15s ease, transform 0.08s ease;
    user-select: none;
    box-sizing: border-box;
  }

  .inline-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .inline-btn:active {
    background: rgba(255, 255, 255, 0.22);
    transform: scale(0.98);
  }

  .inline-btn.loading {
    cursor: wait;
    opacity: 0.8;
  }

  .btn-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-icon {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: btn-spin 0.6s linear infinite;
    display: inline-block;
  }

  @keyframes btn-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
