<script context="module">
  const lottieDataCache = new Map();
  const lottieInflight = new Map();

  let sharedMediaObserver = null;
  const mediaCallbacks = new Map();

  function getMediaObserver() {
    if (!sharedMediaObserver && typeof IntersectionObserver !== "undefined") {
      sharedMediaObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const cb = mediaCallbacks.get(entry.target);
            if (cb) cb(entry);
          }
        },
        {
          rootMargin: "80px 0px",
          threshold: 0.01,
        }
      );
    }
    return sharedMediaObserver;
  }

  function observeMedia(el, cb) {
    const obs = getMediaObserver();
    if (!obs) {
      cb({ isIntersecting: true });
      return () => {};
    }
    mediaCallbacks.set(el, cb);
    obs.observe(el);
    return () => {
      mediaCallbacks.delete(el);
      obs.unobserve(el);
    };
  }

  async function fetchLottieJson(targetUrl) {
    if (!targetUrl) return null;
    if (lottieDataCache.has(targetUrl)) {
      return lottieDataCache.get(targetUrl);
    }
    if (lottieInflight.has(targetUrl)) {
      return lottieInflight.get(targetUrl);
    }
    const promise = (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const text = await invoke("fetch_url_text", { url: targetUrl });
        const parsed = JSON.parse(text);
        lottieDataCache.set(targetUrl, parsed);
        return parsed;
      } catch (e) {
        return null;
      } finally {
        lottieInflight.delete(targetUrl);
      }
    })();
    lottieInflight.set(targetUrl, promise);
    return promise;
  }
</script>

<script>
  import { onMount, onDestroy, tick } from "svelte";
  import lottie from "lottie-web";
  import { getAssetUrl } from "$lib/utils/images";

  export let url = "";
  export let lottieUrl = null;
  export let size = 120;
  export let autoplay = true;
  export let loop = true;
  export let alt = "Sticker";

  let rootEl;
  let containerEl;
  let anim = null;
  let isVisible = false;
  let hasStartedLoading = false;
  let loading = true;
  let loadError = false;
  let resolvedStaticUrl = null;
  let unobserve = null;
  let destroyed = false;

  async function loadStaticImage() {
    if (!url || destroyed) return;
    try {
      const assetUrl = await getAssetUrl(url);
      if (destroyed) return;
      resolvedStaticUrl = assetUrl || url;
    } catch {
      if (destroyed) return;
      resolvedStaticUrl = url;
    }
  }

  async function loadLottieAnimation() {
    if (!lottieUrl || destroyed) return;
    try {
      const data = await fetchLottieJson(lottieUrl);
      if (destroyed || !data) {
        if (!destroyed) {
          loadError = true;
          loadStaticImage();
        }
        return;
      }

      await tick();
      if (destroyed || !containerEl) return;

      if (anim) {
        anim.destroy();
        anim = null;
      }

      anim = lottie.loadAnimation({
        container: containerEl,
        renderer: "svg",
        loop,
        autoplay: autoplay && isVisible,
        animationData: data,
      });

      anim.addEventListener("DOMLoaded", () => {
        if (!destroyed) loading = false;
      });

      anim.addEventListener("data_failed", () => {
        if (!destroyed) {
          loadError = true;
          loadStaticImage();
        }
      });
    } catch {
      if (!destroyed) {
        loadError = true;
        loadStaticImage();
      }
    }
  }

  function startLoading() {
    if (hasStartedLoading || destroyed) return;
    hasStartedLoading = true;
    if (lottieUrl) {
      loadLottieAnimation();
    } else if (url) {
      loadStaticImage();
    } else {
      loading = false;
    }
  }

  onMount(() => {
    if (rootEl) {
      unobserve = observeMedia(rootEl, (entry) => {
        if (entry.isIntersecting) {
          isVisible = true;
          if (!hasStartedLoading) {
            startLoading();
          } else if (anim && anim.isPaused) {
            anim.play();
          }
        } else {
          isVisible = false;
          if (anim && !anim.isPaused) {
            anim.pause();
          }
        }
      });
    }
  });

  onDestroy(() => {
    destroyed = true;
    if (unobserve) {
      unobserve();
      unobserve = null;
    }
    if (anim) {
      anim.destroy();
      anim = null;
    }
  });
</script>

<div
  bind:this={rootEl}
  class="sticker-media"
  style="width: {typeof size === 'number' ? `${size}px` : size}; height: {typeof size === 'number' ? `${size}px` : size};"
>
  {#if hasStartedLoading && lottieUrl && !loadError}
    <div
      bind:this={containerEl}
      class="lottie-container"
      class:hidden={loading}
    ></div>
  {/if}

  {#if hasStartedLoading && (!lottieUrl || loadError) && resolvedStaticUrl}
    <img
      src={resolvedStaticUrl}
      {alt}
      class="static-img"
      class:hidden={loading}
      on:load={() => { loading = false; }}
      on:error={() => { loading = false; }}
    />
  {/if}

  {#if loading}
    <div class="shimmer-placeholder"></div>
  {/if}
</div>

<style>
  .sticker-media {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    flex-shrink: 0;
  }

  .lottie-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lottie-container.hidden,
  .static-img.hidden {
    display: none;
  }

  .static-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .shimmer-placeholder {
    width: 80%;
    height: 80%;
    border-radius: 12px;
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
