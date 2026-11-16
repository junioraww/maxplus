<script>
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import Contacts from "../../routes/contacts/+page.svelte";

  const dispatch = createEventDispatcher();
</script>

<BottomSheet title="Контакты" maxHeight="85vh" on:close={() => dispatch("close")}>
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
