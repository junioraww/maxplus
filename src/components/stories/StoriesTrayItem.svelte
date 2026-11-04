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
      size={56}
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
    gap: 6px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .ring-container {
    position: relative;
    width: 56px;
    height: 56px;
  }

  .owner-name-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-color, #e4e7eb);
    max-width: 64px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
