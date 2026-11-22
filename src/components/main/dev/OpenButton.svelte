<script>
  import { openDevSettings } from "$lib/stores/session";

  const open = () => {
    openDevSettings();
  };
</script>

<div on:click={open} class="open-dev">
  <a>Настройки отладки</a>
</div>

<style>
  .open-dev {
    position: absolute;
    z-index: var(--z-floating);
    color: white;
    width: 200px;
    height: 40px;
    top: calc(20px + var(--safe-top, 0px));
    right: 0;
    background: linear-gradient(270deg, #333, #444), #333;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 20px 0 0 20px;
    cursor: pointer;
  }
</style>
