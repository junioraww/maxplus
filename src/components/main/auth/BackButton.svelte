<script>
  import { goto } from "$app/navigation";

  export let condition;
  export let path;
  export let top = 75;

  const _condition = condition || (() => true);

  function goBack() {
    if (path) goto(path);
    else history.back();
  }
</script>

{#await _condition() then display}
  {#if display}
      <div
      class="back"
      style:top={`${top}px`}
      on:click={goBack}
      ><a>←</a></div>
  {/if}
{/await}

<style>
  .back {
    position: absolute;
    height: 32px;
    width: 32px;
    border-radius: 32px;
    background-color: #fff3;
    display: flex;
    align-items: center;
    justify-content: center;
    left: 10px;
    font-weight: 1000;
  }

  .back a {
    line-height: 0;
    position: relative;
    bottom: 1px;
  }
</style>
