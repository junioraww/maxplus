<script>
  import Session from "$lib/stores/session";

  const addContact = () => {
    $Session.contactModal = true;
  };
</script>

<div
  class="add-contact top-btn animated-panel"
  role="switch"
  class:visible={$Session.contactModal}
  on:click={addContact}
>
  <svg width="20" height="20" viewBox="0 0 20 20">
    <rect x="9" y="4" width="2" height="12" fill="var(--icon-primary)" />
    <rect x="4" y="9" width="12" height="2" fill="var(--icon-primary)" />
  </svg>
</div>

<style>
  .top-btn {
    width: 30px;
    height: 30px;
    border-radius: 11px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
  }
</style>
