<script>
  import { getAttachText } from "$lib/utils/attachs";
  import { getContact } from "$lib/stores/contacts";
  import { currentUser } from "$lib/stores/api";

  export let replyTo;
  export let messages;
  export let chat;

  $: replyToMsg = $messages.find((x) => x.id === replyTo);
  $: cachedContact = getContact(replyToMsg?.sender);
  $: contact = $cachedContact || {
    names: [{ first_name: "?" }],
  };
  $: isMe = Number(replyToMsg?.sender) === Number($currentUser);
  $: authorName = isMe
    ? "Ответ себе"
    : (contact?.names?.[0]?.firstName || contact?.names?.[0]?.first_name || contact?.first_name || "Ответ");
  $: attachText = getAttachText(chat, replyToMsg);
</script>

{#if replyToMsg}
  <div class="reply-preview">
    <div class="reply-line"></div>

    <div class="reply-content">
      <div class="reply-author">
        {authorName}
      </div>

      <div class="reply-text">
        {#if attachText}
          <span class="reply-attach">{attachText}</span>
        {/if}
        {replyToMsg.text || ""}
      </div>
    </div>

    <button class="reply-close" type="button" on:click={() => (replyTo = null)} title="Отменить ответ">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 18px; height: 18px;"></span>
    </button>
  </div>
{/if}

<style>
  .reply-preview {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    padding: 6px 12px 2px 12px;
    border: none;
    box-sizing: border-box;
    width: 100%;
  }

  .reply-line {
    width: 2.5px;
    height: 32px;
    background: var(--accent-primary, #248bfe);
    border-radius: 1.5px;
    flex-shrink: 0;
  }

  .reply-content {
    flex-grow: 1;
    overflow: hidden;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .reply-author {
    font-size: 13px;
    line-height: 16px;
    color: var(--text-secondary, #8a8d9b);
    font-weight: 400;
  }

  .reply-text {
    margin-top: 1px;
    font-size: 15px;
    line-height: 19px;
    color: #ffffff;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reply-attach {
    font-weight: 400;
    margin-right: 4px;
    color: rgba(255, 255, 255, 0.85);
  }

  .reply-close {
    background: none;
    border: none;
    color: var(--text-secondary, #8a8d9b);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: color 0.15s ease, background-color 0.15s ease;
  }

  .reply-close:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }
</style>
