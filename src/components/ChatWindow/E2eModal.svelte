<script>
  import { Modal, Button } from "$components/ui";
  import { fade, scale } from "svelte/transition";
  import { handleEnc, dismissRequest } from "$components/ChatWindow/e2e.js";

  export let gotSecretChatRequest;

  export let chat;
  export let messages;
  export let chatSettings;

  async function action(name) {
    const res = await handleEnc(chat, chatSettings, messages, name);
    gotSecretChatRequest = null;
    return res;
  }

  function closeModal() {
    if (gotSecretChatRequest?.messageId) {
      dismissRequest(chat?.id, gotSecretChatRequest.messageId);
    }
    gotSecretChatRequest = null;
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      closeModal();
    }
  }
</script>


{#if gotSecretChatRequest}
  <Modal open={true} size="sm" showClose={false} class="e2e-modal" onclose={closeModal}>
      <div class="modal-header">
        <div class="icon-wrap">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h2>Секретный чат</h2>
      </div>

      <div class="modal-body">
        <p>Собеседник предлагает защитить переписку с помощью шифрования</p>

        <div class="warning-box">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
            ></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <p>
            <strong>Внимание:</strong> после выхода из аккаунта вы, скорее всего,
            не сможете прочесть сообщения из этого чата
          </p>
        </div>
      </div>

      <div class="modal-actions">
        <div class="main-actions">
          <Button variant="primary" full onclick={() => action("agree")}>Согласиться</Button>
          <Button variant="secondary" full onclick={() => action("deny")}>Отказаться</Button>
        </div>
        <Button variant="ghost" full onclick={() => action("block")}>Не показывать 5 минут</Button>
      </div>
    </Modal>
{/if}

<style>
  :global(.e2e-modal .modal__body) { padding: 0; }


  .modal-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--text-primary);
  }

  .icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.12);
    color: var(--status-success);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .modal-body p {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .warning-box {
    background-color: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.25);
    border-radius: 10px;
    padding: 12px;
    margin-top: 14px;
    display: flex;
    align-items: center;
    text-align: left;
    gap: 10px;
  }

  .warning-box svg {
    stroke: #fbbf24;
    flex-shrink: 0;
  }

  .warning-box p {
    font-size: 13px;
    color: #fef08a;
    line-height: 1.45;
  }

  .warning-box p strong {
    color: #fde047;
  }

  .modal-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 6px;
  }

  .main-actions {
    display: flex;
    gap: 12px;
  }









</style>
