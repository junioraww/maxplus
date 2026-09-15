<script>
  export let index = 0;
  export let active = 0;

  $: isCurrent = index === active;
</script>

<div
  class="page-card"
  class:inactive={!isCurrent}
  style="transform: translateX({(index - active) * 100}vw)"
>
  <slot />
</div>

<style>
  .page-card {
    position: absolute;
    z-index: 1;
    top: 0;
    left: 0;
    width: 100vw;
    height: calc(100vh - 60px);
    transition: transform 0.22s ease-out;
    display: flex;
    flex-direction: column;
  }

  .page-card.inactive {
    pointer-events: none;
    user-select: none;
  }
</style>
