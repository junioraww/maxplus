<script>
  import { set as sessionSet } from "$lib/stores/session";

  const open = () => {
    sessionSet("devicesPage", true);
  };
</script>

<div on:click={open} class="open-dev">
  <img src="/icons/phone.svg"/>
</div>

<style>
  .open-dev {
    position: absolute;
    z-index: 100;
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

  .open-dev:hover {
    padding-right: 5px;
  }
</style>
