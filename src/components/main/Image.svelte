<script>
  import MediaCanvas from "$components/main/MediaCanvas.svelte";

  let { src, alt = "", class: className = "", style = "", ...props } = $props();
</script>

{#if src}
  <MediaCanvas {src} type="image" {alt} class={className} {style} {...props} />
{:else}
  <img src="/missing.jpg" alt="" class={"missing " + className} {style} {...props} />
{/if}

<style>
  .missing {
    image-rendering: pixelated;
  }
</style>
