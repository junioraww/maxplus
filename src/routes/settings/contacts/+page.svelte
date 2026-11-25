<script>
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import Contacts from "../../contacts/+page.svelte";

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";
</script>

<SettingsPageWrapper title="Контакты" {from} {isTab} {onClose}>
  <div class="contacts-settings-body">
    <Contacts hideHeader={true} />
  </div>
</SettingsPageWrapper>

<style>
  .contacts-settings-body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
