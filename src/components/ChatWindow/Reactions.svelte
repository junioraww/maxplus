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
    -webkit-user-select: none;
  }

  .reactions-strip.is-me {
    justify-content: flex-end;
  }

  .reaction-bubble-chip {
    background: var(--reaction-chip-bg, rgba(255, 255, 255, 0.1));
    border: none;
    border-radius: 14px;
    height: 28px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    gap: 4px;
    cursor: pointer;
    color: var(--reaction-chip-text, rgba(255, 255, 255, 0.92));
    transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.18s ease, color 0.18s ease;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .reaction-bubble-chip:hover {
    background: var(--reaction-chip-hover-bg, rgba(255, 255, 255, 0.16));
  }

  .reaction-bubble-chip:active {
    transform: scale(0.95);
  }

  .reaction-bubble-chip.is-your {
    background: var(--accent-color, #8b5cf6);
    color: #ffffff;
  }

  .reaction-bubble-chip.is-your:hover {
    filter: brightness(1.08);
    background: var(--accent-color, #8b5cf6);
  }

  .reaction-bubble-chip .emoji {
    font-size: 16px;
    line-height: 1;
  }

  .reaction-bubble-chip .amount {
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
  }
</style>
