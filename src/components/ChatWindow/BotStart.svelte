<script>
  import Avatar from "$components/main/Avatar.svelte";

  let { botInfo, contact, contactId, onStart, loading = false } = $props();

  let name = $derived(
    botInfo?.contact?.names?.[0]?.name ||
    contact?.names?.[0]?.name ||
    contact?.names?.[0]?.firstName ||
    "Бот"
  );

  let description = $derived(
    botInfo?.description ||
    botInfo?.contact?.description ||
    contact?.description ||
    "Этот бот поможет вам решать различные задачи прямо в чате."
  );

  let resolvedContactId = $derived(contactId || contact?.id);
</script>

<div class="bot-start-container">
  <div class="bot-card">
    <Avatar size={70} contactId={resolvedContactId} style="chat" />
    <h3 class="bot-name">{name}</h3>
    <div class="bot-desc-title">Что умеет этот бот?</div>
    <p class="bot-desc-text">{description}</p>
  </div>

  <div class="bot-start-footer">
    <button
      type="button"
      class="bot-start-btn"
      disabled={loading}
      onclick={onStart}
    >
      {#if loading}
        <span class="start-spinner"></span>
      {:else}
        Запустить
      {/if}
    </button>
  </div>
</div>

<style>
  .bot-start-container {
    position: absolute;
    top: 50px;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    z-index: 6;
    pointer-events: none;
  }

  .bot-card {
    background: rgba(36, 40, 50, 0.85);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    padding: 24px 20px;
    max-width: 320px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    pointer-events: auto;
  }

  .bot-name {
    margin: 12px 0 6px;
    color: #fff;
    font-size: 18px;
    font-weight: 600;
  }

  .bot-desc-title {
    color: #8e8e93;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 8px;
  }

  .bot-desc-text {
    color: #ddd;
    font-size: 14px;
    line-height: 1.4;
    margin: 0;
    word-break: break-word;
  }

  .bot-start-footer {
    position: absolute;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    left: 16px;
    right: 16px;
    display: flex;
    justify-content: center;
    pointer-events: auto;
  }

  .bot-start-btn {
    width: 100%;
    max-width: 480px;
    height: 48px;
    background: #248bfe;
    border: none;
    border-radius: 12px;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, transform 0.08s ease;
    box-shadow: 0 4px 14px rgba(36, 139, 254, 0.35);
  }

  .bot-start-btn:hover {
    background: #1b7ee8;
  }

  .bot-start-btn:active {
    transform: scale(0.98);
  }

  .bot-start-btn:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .start-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: start-spin 0.6s linear infinite;
  }

  @keyframes start-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
