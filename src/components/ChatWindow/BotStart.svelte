<script>
  import { Button } from "$components/ui";
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
    "Этот бот поможет вам решать задачи прямо в чате."
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
    <Button variant="primary" class="botstart-bot-start-btn" disabled={loading} onclick={onStart}>
      {#if loading}
        <span class="start-spinner"></span>
      {:else}
        Запустить
      {/if}
    </Button>
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
    background: #242832;
    border: 1px solid var(--border-subtle);
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
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 600;
  }

  .bot-desc-title {
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 8px;
  }

  .bot-desc-text {
    color: var(--text-primary);
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

  :global(.botstart-bot-start-btn)  { width: 100%; max-width: 480px; }


  :global(.botstart-bot-start-btn):active  { transform: scale(0.98); }


  .start-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: var(--border-subtle);
    border-radius: 50%;
    animation: start-spin 0.6s linear infinite;
  }

  @keyframes start-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
