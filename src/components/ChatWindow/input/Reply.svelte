<script>
  import { IconButton } from "$components/ui";
  import { getAttachText } from "$lib/utils/attachs.js";
  import { getContact } from "$lib/stores/contacts";

  export let replyTo;
  export let messages;
  export let chat;

  $: replyToMsg = $messages.find((x) => x.id === replyTo);
  $: cachedContact = getContact(replyToMsg.sender);
  $: contact = $cachedContact || {
    names: [{ first_name: "?" }],
  };
  $: attachText = getAttachText(chat, replyToMsg);
</script>

<div class="reply-preview">
  <div class="reply-line"></div>

  <div class="reply-content">
    <div class="reply-author">
      Ответ <b>{contact.names[0].firstName}</b>
    </div>

    <div class="reply-text">
      <b>{attachText ? attachText + (replyToMsg.text ? "," : "") : ""}</b>
      {replyToMsg.text}
    </div>
  </div>

  <IconButton class="reply-reply-close" onclick={() => (replyTo = null)}> ✕ </IconButton>
</div>

<style>
  .reply-preview {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-surface);
    border-radius: 10px;
    padding: 8px 10px;
    margin: 0 8px 6px 8px;
    position: relative;
  }

  .reply-line {
    width: 3px;
    height: 100%;
    background: #4a90e2;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .reply-content {
    flex-grow: 1;
    overflow: hidden;
    padding: 3px 0;
  }

  .reply-author {
    font-size: 13px;
    color: var(--accent-primary);
    font-weight: 500;
  }

  .reply-text {
    margin-top: 2px;
    font-size: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }


</style>
