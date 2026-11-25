<script>
  import { createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import UserSelectScreen from "$components/chats/UserSelectScreen.svelte";
  import { getContact, getContactDisplayName } from "$lib/stores/contacts";

  const dispatch = createEventDispatcher();

  export let close = null;
  export let onSelect = null;

  function handleSelect(picked) {
    if (!picked?.id) return;
    const contact = get(getContact(picked.id)) || {};
    const detail = {
      contactId: picked.id,
      name: getContactDisplayName(contact) || picked.name,
      phone: contact.phone || contact.phone_number || contact.phoneNumber || "",
      avatar: contact.avatar || picked.avatar || null
    };
    dispatch("select", detail);
    if (typeof onSelect === "function") {
      onSelect(detail);
    }
  }
</script>

<UserSelectScreen
  title="Поделиться контактом"
  emptyText="Список контактов пуст"
  searchPlaceholder="Поиск контактов"
  multiSelect={false}
  autoAddToChat={false}
  {close}
  onSelect={handleSelect}
  on:close={() => dispatch("close")}
/>
