<script>
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import Contacts from "../../routes/contacts/+page.svelte";

  export let close = null;
  export let setBackHandler = null;

  const dispatch = createEventDispatcher();
</script>

<BottomSheet title="Контакты" maxHeight="85vh" {close} {setBackHandler} on:close={() => { dispatch("close"); if (close) close(); }}>
  <div class="contacts-modal-body">
    <Contacts hideHeader={true} />
  </div>
</BottomSheet>

<style>
  .contacts-modal-body {
    height: 75vh;
    overflow: hidden;
    position: relative;
  }
</style>
