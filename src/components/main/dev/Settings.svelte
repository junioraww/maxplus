<script>
  import { fade } from "svelte/transition";
  import { goto } from "$app/navigation";
  import Session, {
    get as sessionGet,
    set as sessionSet,
  } from "$lib/stores/session";

  let visualMarker = sessionGet("visualMarker");

  const swapVisualMarker = () => {
    visualMarker = !visualMarker;

    const classes = ["debug-a", "debug-b", "debug-c", "debug-d", "debug-e"];

    classes.forEach((cls) => {
      document.querySelectorAll(`.${cls}`).forEach((el) => {
        el.style.display = visualMarker ? "flex" : "none";
      });
    });
  };
</script>

<div in:fade={{ duration: 100 }} out:fade={{ duration: 100 }} class="main">
  <div on:click={() => sessionSet("devSettings", false)} class="close">
    Закрыть
  </div>

  <a>Настройки отладки</a>

  <div class="buttons">
    <div class="group">
      <div on:click={swapVisualMarker} class="button">
        <a>{visualMarker ? "Отключить" : "Включить"} визуальные маркеры</a>
      </div>
    </div>
    <div class="group">
      <div
        on:click={() => {
          sessionSet("devSettings", false);
          goto("/settings/logs?from=/?card=settings");
        }}
        class="button"
      >
        <a>Сетевые логи</a>
      </div>
    </div>
    <div class="group">
      <div
        on:click={() => {
          sessionSet("devSettings", false);
          goto("/");
        }}
        class="button"
      >
        <a>На главную</a>
      </div>
    </div>
  </div>
</div>

<style>
  .main {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: #202025ee;
    z-index: 200;
    display: flex;
    align-items: center;
    color: white;
    font-size: 24px;
    font-weight: 600;
    padding-top: 24px;
    flex-direction: column;
  }

  .close {
    position: absolute;
    bottom: 42px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #6366f1;
    color: white;
    border: none;
    padding: 8px 20px;
    border-radius: 8px;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  .close:hover {
    background: #4f46e5;
  }

  .buttons {
    margin: 20px 10px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    font-size: 14px;
    width: 80%;
  }

  .buttons .group {
    background-color: #26262e;
    border-radius: 15px;
  }

  .buttons .group .button {
    padding: 12px 15px;
    display: flex;
    flex-direction: row;
    cursor: pointer;
    align-items: center;
    justify-content: center;
  }
</style>
