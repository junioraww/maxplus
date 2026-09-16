<script>
  import { getAssetUrl } from "$lib/utils/images";

  let { src, alt = "", class: className = "", ...props } = $props();

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
  <img src={localUrl} {alt} class={className} {...props} />
{:else if error}
  <img src="/missing.jpg" class={"missing " + className} {...props} />
{:else}
  <div class={"shimmer-placeholder " + className} {...props}></div>
{/if}

<style>
  .missing {
    image-rendering: pixelated;
  }

  .shimmer-placeholder {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 35%,
      rgba(79, 195, 247, 0.16) 50%,
      rgba(255, 255, 255, 0.12) 65%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.6s infinite linear;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
