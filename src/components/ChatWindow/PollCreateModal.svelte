<script>
  import { createEventDispatcher } from "svelte";
  import PollCreateScreen from "./PollCreateScreen.svelte";

  const dispatch = createEventDispatcher();
  export let onCreate = null;

  function handleCreate(e) {
    dispatch("create", e.detail);
    if (onCreate) onCreate(e.detail);
  }

  function handleClose() {
    dispatch("close");
  }
</script>

<PollCreateScreen on:create={handleCreate} on:close={handleClose} close={handleClose} {onCreate} />
