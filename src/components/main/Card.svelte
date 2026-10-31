<script>
  import { setContext } from "svelte";
  import { writable } from "svelte/store";

  export let index = 0;
  export let active = 0;
  export let isVisibleOnScreen = true;

  $: isCurrent = index === active;
  const panelActiveStore = writable(isCurrent || isVisibleOnScreen);
  $: $panelActiveStore = isCurrent || isVisibleOnScreen;
  setContext("panelActive", panelActiveStore);
</script>

<div
  class="page-card"
  class:inactive={!isCurrent}
  style="left: {index * 100}%;"
  aria-hidden={!isCurrent}
>
  <slot />
</div>

<style>
  .page-card {
    position: absolute;
    z-index: 1;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-app, #17181c);
    box-sizing: border-box;
  }

  .page-card.inactive {
    pointer-events: none;
    user-select: none;
  }
</style>
