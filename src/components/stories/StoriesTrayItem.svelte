<script>
  import { getContact, getContactDisplayName } from "$lib/stores/contacts";
  import StoryRing from "./StoryRing.svelte";

  export let preview;
  export let onOwnerClick;

  $: ownerId = preview?.owner?.ownerId;
  $: contactStore = ownerId ? getContact(ownerId) : null;
  $: contact = $contactStore;
  $: displayName = getContactDisplayName(contact) || contact?.name || (ownerId ? `ID ${ownerId}` : "");
</script>

<div
  class="story-item-col"
  on:click={() => onOwnerClick(preview)}
  role="button"
  tabindex="0"
>
  <div class="ring-container">
    <StoryRing
      {preview}
      size={62}
      on:click={() => onOwnerClick(preview)}
    />
  </div>
  <span class="owner-name-label">
    {displayName}
  </span>
</div>

<style>
  .story-item-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 62px;
    height: 88px;
    cursor: pointer;
    flex-shrink: 0;
    box-sizing: border-box;
    justify-content: flex-start;
    padding-bottom: 6px;
  }

  .ring-container {
    position: relative;
    width: 62px;
    height: 62px;
    flex-shrink: 0;
  }

  .owner-name-label {
    margin-top: auto;
    font-size: 12px;
    line-height: 16px;
    font-weight: 400;
    letter-spacing: 0.025em;
    color: var(--text-color, #e4e7eb);
    max-width: 62px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
