<script>
  import { openDevicesSettings } from "$lib/stores/session";

  const open = () => {
    openDevicesSettings();
  };
</script>

<div on:click={open} class="open-dev">
  <img src="/icons/phone.svg" alt="" />
</div>

<style>
  .open-dev {
    position: absolute;
    z-index: var(--z-floating);
    color: white;
    width: 50px;
    height: 40px;
    top: calc(70px + var(--safe-top, 0px));
    right: 0;
    background: linear-gradient(270deg, #333, #444), #333;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 30px 0 0 30px;
    cursor: pointer;
    transition: padding 0.1s;
  }
</style>
