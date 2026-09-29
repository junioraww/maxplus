<script>
  import { createEventDispatcher } from "svelte";

  export let info;
  export let msgId = null;
  export let isMe = false;

  const dispatch = createEventDispatcher();

  function handleClick(e, reaction) {
    e.stopPropagation();
    dispatch("react", { reaction, msgId });
  }
</script>

{#if info?.counters && info.counters.length > 0}
  <div class="reactions-strip" class:is-me={isMe} data-msg-id={msgId}>
    {#each info.counters as entry (entry.reaction)}
      {@const isYour = info.yourReaction === entry.reaction}
      <button
        type="button"
        class="reaction-bubble-chip"
        class:is-your={isYour}
        on:click={(e) => handleClick(e, entry.reaction)}
        aria-label="Reaction {entry.reaction}"
      >
        <span class="emoji">{entry.reaction}</span>
        <span class="amount">{entry.count}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .reactions-strip {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
    user-select: none;
  }

  .reactions-strip.is-me {
    justify-content: flex-end;
  }

  .reaction-bubble-chip {
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 14px;
    padding: 2px 7px;
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    gap: 4px;
    cursor: pointer;
    color: #ffffff;
    transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.15s ease, border-color 0.15s ease;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .reaction-bubble-chip:hover {
    background: rgba(255, 255, 255, 0.22);
    transform: scale(1.05);
  }

  .reaction-bubble-chip:active {
    transform: scale(0.94);
  }

  .reaction-bubble-chip.is-your {
    background: rgba(123, 76, 214, 0.45);
    border-color: rgba(167, 139, 250, 0.65);
    box-shadow: 0 0 8px rgba(123, 76, 214, 0.35);
  }

  .reaction-bubble-chip .emoji {
    font-size: 13px;
    line-height: 1;
  }

  .reaction-bubble-chip .amount {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.9;
    line-height: 1;
  }
</style>
