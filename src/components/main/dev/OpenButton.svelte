<script>
  import { set as sessionSet } from "$lib/stores/session.js";

  const open = () => {
    sessionSet("devSettings", true);
  };
</script>

<div on:click={open} class="open-dev">
  <a>Настройки отладки</a>
</div>

<style>
  .open-dev {
    position: absolute;
    z-index: 100;
    color: var(--text-primary);
    width: 200px;
    height: 40px;
    top: 20px;
    right: 0;
    background: linear-gradient(270deg, var(--bg-surface-2), #444), var(--bg-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 100px 0 0 100px;
    cursor: pointer;
    transition: padding 0.1s;
    font-size: 16px;
  }

  .open-dev:hover {
    padding-right: 5px;
  }
</style>
