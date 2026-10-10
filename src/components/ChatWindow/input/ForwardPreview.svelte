<script>
  import { IconButton } from "$components/ui";
  import { forwardDraft, clearForwardDraft } from "$lib/stores/forwardDraft.js";
  import { getContact } from "$lib/stores/contacts";
  import { currentUser, currentUserDetails, currentSessionChats } from "$lib/stores/api";

  $: draft = $forwardDraft;
  $: msgs = draft?.messages || [];
  $: firstMsg = msgs[0];
  $: isMe = Number(firstMsg?.sender) === Number($currentUser);
  $: cachedContact = firstMsg?.sender ? getContact(firstMsg.sender) : null;
  $: contact = $cachedContact;
  $: sourceChat = draft?.sourceChatId != null ? $currentSessionChats?.find(c => String(c.id) === String(draft.sourceChatId)) : null;

  $: authorName = (() => {
    if (firstMsg?.link?.chatName) return firstMsg.link.chatName;
    if (sourceChat?.type === "CHANNEL" || (!firstMsg?.sender && sourceChat?.title)) {
      return sourceChat.title;
    }
    if (isMe) {
      if ($currentUserDetails?.names?.[0]?.firstName) {
        return `${$currentUserDetails.names[0].firstName} ${$currentUserDetails.names[0].lastName || ""}`.trim();
      }
      return $currentUserDetails?.name || "Вы";
    }
    if (contact?.names?.[0]?.firstName) {
      return `${contact.names[0].firstName} ${contact.names[0].lastName || ""}`.trim();
    }
    if (contact?.name) return contact.name;
    if (sourceChat?.title) return sourceChat.title;
    if (firstMsg?.sender) return String(firstMsg.sender);
    return "";
  })();
</script>

{#if msgs.length > 0}
  <div class="forward-preview">
    <div class="forward-line"></div>
    <div class="forward-icon">
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="#a78bfa" stroke-width="2" fill="none">
        <polyline points="15 14 20 9 15 4"></polyline>
        <path d="M4 20v-7a4 4 0 0 1 4-4h12"></path>
      </svg>
    </div>
    <div class="forward-content">
      <div class="forward-header">
        {#if msgs.length === 1}
          Переслать от <b>{authorName || "сообщения"}</b>
        {:else}
          Переслать <b>{msgs.length}</b> сообщ.
        {/if}
      </div>
      <div class="forward-text">
        {firstMsg?.text || (firstMsg?.attaches?.length ? "Вложение" : "")}
      </div>
    </div>
    <IconButton class="forwardpreview-forward-close" onclick={clearForwardDraft} aria-label="Отменить">
      ✕
    </IconButton>
  </div>
{/if}

<style>
  .forward-preview {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-surface);
    border-radius: 10px;
    padding: 8px 10px;
    margin: 0 8px 6px 8px;
    position: relative;
    box-sizing: border-box;
  }

  .forward-line {
    width: 3px;
    height: 100%;
    min-height: 28px;
    background: #a78bfa;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .forward-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .forward-content {
    flex-grow: 1;
    overflow: hidden;
    padding: 2px 0;
    min-width: 0;
  }

  .forward-header {
    font-size: 13px;
    color: var(--accent-violet);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .forward-text {
    font-size: 13px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.forwardpreview-forward-close)  { flex-shrink: 0; }

</style>
