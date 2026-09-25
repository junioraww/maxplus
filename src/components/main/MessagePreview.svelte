<script>
  import { getAttachText, getSystemText } from "$lib/utils/attachs.js";

  export let chat;
  export let msg;
  export let cut = false;

  function strip(s) {
    return (s || "").replace(/<[^>]*>/g, "").trim();
  }

  $: isControl = Boolean(msg?.attaches?.some((x) => (x.type || x._type) === "CONTROL"));
  $: attachText = strip(getAttachText(chat, msg));
  $: rawText = strip(isControl ? (getSystemText(msg, false) || msg?.text || "") : (msg?.text || ""));
  $: sameText = Boolean(attachText && rawText && (attachText === rawText || rawText.includes(attachText) || attachText.includes(rawText)));

  $: displayText = isControl
    ? rawText
    : (sameText
      ? (rawText || attachText)
      : (attachText ? (rawText ? `${attachText}, ${rawText}` : attachText) : rawText));

  $: previewText = cut ? displayText.slice(0, 20) : displayText;
  $: isLong = cut && displayText.length > 20;
</script>

<div class="message">
  {#if !isControl && !sameText && attachText && rawText}
    <b>{attachText},</b> {previewText}{#if isLong}...{/if}
  {:else if !isControl && !sameText && attachText}
    <b>{attachText}</b>
  {:else}
    {previewText}{#if isLong}...{/if}
  {/if}
</div>
