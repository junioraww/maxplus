<script>
  import { onMount, onDestroy, afterUpdate } from "svelte";

  export let handler;
  export let text = "";
  export let msg = null;
  export let chat = null;
  export let isMe = false;

  let rootEl = null;
  let cleanup = null;
  let lastKey = "";

  function renderCard() {
    if (!rootEl || !handler) return;
    const nextKey = `${msg?.id ?? ""}:${text}`;
    if (nextKey === lastKey) return;
    lastKey = nextKey;

    if (typeof cleanup === "function") {
      try { cleanup(); } catch {}
      cleanup = null;
    }

    try {
      const rendered = handler.render?.(text, { msg, chat, isMe }) ?? "";
      rootEl.innerHTML = rendered;
      if (typeof handler.onMount === "function") {
        cleanup = handler.onMount(rootEl, { text, msg, chat, isMe }) || null;
      }
    } catch (e) {
      console.error("[plugin-message-card] render error:", e);
    }
  }

  onMount(renderCard);
  afterUpdate(renderCard);

  onDestroy(() => {
    if (typeof cleanup === "function") {
      try { cleanup(); } catch {}
      cleanup = null;
    }
  });
</script>

<div class="plugin-message-card" bind:this={rootEl}></div>

<style>
  .plugin-message-card {
    width: 100%;
    min-width: 210px;
  }
</style>
