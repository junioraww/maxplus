<script>
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { openChat } from "$lib/stores/session";
  import { handleDeepLinkUrl } from "$lib/utils/deepLink";
  import { compileDisplayBlocks } from "$lib/formatting/parser";
  import { STYLE_KEYS } from "$lib/formatting/constants";
  import LinkDropout from "$components/ChatWindow/LinkDropout.svelte";

  export let text = "";
  export let elements = [];
  export let deleted = false;
  export let isSystem = false;

  $: blocks = compileDisplayBlocks(text, elements);

  function getStyleClasses(styles) {
    let res = "";
    for (const s of styles) res += ` ${s}-text`;
    return res;
  }

  let activeLinkModal = null;
  let longPressTimer = null;
  let didLongPress = false;
  let startX = 0;
  let startY = 0;

  function handleLinkPointerDown(e, url) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    startX = e.clientX;
    startY = e.clientY;
    didLongPress = false;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      didLongPress = true;
      activeLinkModal = {
        url,
        clientX: e.clientX,
        clientY: e.clientY,
      };
    }, 450);
  }

  function handleLinkPointerMove(e) {
    if (!longPressTimer) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx > 8 || dy > 8) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleLinkPointerUp() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function handleLinkContextMenu(e, url) {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(longPressTimer);
    longPressTimer = null;
    activeLinkModal = {
      url,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }

  async function handleLinkClick(url) {
    if (didLongPress) {
      didLongPress = false;
      return;
    }
    if (!url) return;
    try {
      const handled = await handleDeepLinkUrl(url);
      if (handled) return;
    } catch (e) {
      console.error(e);
    }
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function handleMentionClick(userId) {
    if (userId != null && userId !== 0) {
      openChat(Number(userId));
    }
  }
</script>

{#snippet renderSpans(spans)}
  {#each spans as span}
    {#if span.linkUrl}
      <a
        class="rich-link{getStyleClasses(span.styles)}"
        style={span.color ? `color: ${span.color};` : ""}
        href={span.linkUrl}
        on:pointerdown={(e) => handleLinkPointerDown(e, span.linkUrl)}
        on:pointermove={handleLinkPointerMove}
        on:pointerup={handleLinkPointerUp}
        on:pointercancel={handleLinkPointerUp}
        on:contextmenu={(e) => handleLinkContextMenu(e, span.linkUrl)}
        on:click|preventDefault={() => handleLinkClick(span.linkUrl)}
      >{span.text}</a>
    {:else if span.mentionId}
      <span
        class="rich-mention{getStyleClasses(span.styles)}"
        style={span.color ? `color: ${span.color};` : ""}
        role="button"
        tabindex="0"
        on:click|stopPropagation={() => handleMentionClick(span.mentionId)}
        on:keydown|stopPropagation={(e) => e.key === "Enter" && handleMentionClick(span.mentionId)}
      >{span.text}</span>
    {:else}
      <span
        class="rich-span{getStyleClasses(span.styles)}"
        class:code-block={span.styles.has(STYLE_KEYS.CODE) && span.text.includes("\n")}
        style={span.color ? `color: ${span.color};` : ""}
      >{span.text}</span>
    {/if}
  {/each}
{/snippet}

<div class="rich-content" class:deleted-content={deleted} class:system-content={isSystem}>
  {#each blocks as block}
    {#if block.isQuote}
      <blockquote class="quote-container">
        <div class="quote-bar"></div>
        <div class="quote-body">
          {@render renderSpans(block.spans)}
        </div>
      </blockquote>
    {:else}
      <p class="paragraph-container" class:system-paragraph={isSystem}>
        {@render renderSpans(block.spans)}
      </p>
    {/if}
  {/each}
</div>

{#if activeLinkModal}
  <LinkDropout
    url={activeLinkModal.url}
    clientX={activeLinkModal.clientX}
    clientY={activeLinkModal.clientY}
    on:close={() => (activeLinkModal = null)}
  />
{/if}

<style>
  .rich-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    word-break: break-word;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
    line-height: 1.4;
  }

  .paragraph-container {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .system-paragraph {
    text-align: center;
  }

  .quote-container {
    margin: 3px 0;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: flex;
    gap: 8px;
    position: relative;
    border-left: 3px solid rgba(255, 255, 255, 0.5);
  }

  .quote-bar {
    display: none;
  }

  .quote-body {
    white-space: pre-wrap;
    word-break: break-word;
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.96em;
  }

  .rich-span {
    white-space: inherit;
    word-break: inherit;
  }

  .bold-text {
    font-weight: 700;
  }

  .italic-text {
    font-style: italic;
  }

  .underline-text {
    text-decoration: underline;
  }

  .strike-text {
    text-decoration: line-through;
  }

  .code-text {
    font-family: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.32);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .code-text.code-block {
    display: block;
    margin: 6px 0;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(18, 22, 28, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.12);
    overflow-x: auto;
    line-height: 1.5;
    tab-size: 2;
  }

  .heading-text {
    font-size: 1.14em;
    font-weight: 700;
    display: inline-block;
  }

  .rich-link {
    color: #64b5f6;
    text-decoration: underline;
    cursor: pointer;
    white-space: inherit;
    word-break: inherit;
  }

  .rich-link:hover {
    color: #90caf9;
  }

  .rich-mention {
    color: #bb86fc;
    font-weight: 600;
    cursor: pointer;
    white-space: inherit;
    word-break: inherit;
  }

  .rich-mention:hover {
    text-decoration: underline;
  }

  .deleted-content {
    opacity: 0.7;
    font-style: italic;
  }

  .rich-link[style*="color:"],
  .rich-mention[style*="color:"],
  .rich-span[style*="color:"] {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
</style>
