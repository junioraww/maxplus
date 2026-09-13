<script>
  import { getAssetUrl } from "$lib/utils/images";

  let { src, alt = "", ...props } = $props();

  let localUrl = $state(null);
  let error = $state(false);

  $effect(() => {
    let cancelled = false;

    async function load() {
      error = false;
      localUrl = null;

      if (!src) return;

      const url = await getAssetUrl(src);

      if (!cancelled) {
        if (url) {
          localUrl = url;
        } else {
          error = true;
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  });
</script>

{#if localUrl}
  <img src={localUrl} {alt} {...props} />
{:else if error}
  <img src="/missing.jpg" class="missing" {...props} />
{/if}

<style>
  .missing {
    image-rendering: pixelated;
  }
</style>
