<script>
  import { createEventDispatcher } from "svelte";
  import GroupSharedMedia from "./GroupSharedMedia.svelte";
  import PortalScreenWrapper from "$components/portal/PortalScreenWrapper.svelte";

  export let chat = null;
  export let close = null;
  export let setBackHandler = null;

  const dispatch = createEventDispatcher();

  function handleClose() {
    if (typeof close === "function") {
      close();
    } else {
      dispatch("close");
    }
  }
</script>

<PortalScreenWrapper
  title="Вложения"
  bg="var(--bg-surface)"
  close={handleClose}
  {setBackHandler}
>
  <div class="shared-media-screen-body">
    {#if chat}
      <GroupSharedMedia {chat} />
    {/if}
  </div>
</PortalScreenWrapper>

<style>
  .shared-media-screen-body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 12px 16px calc(24px + var(--safe-bottom, 0px));
    box-sizing: border-box;
  }
</style>
