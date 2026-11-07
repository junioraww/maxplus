<script>
  import { page } from "$app/stores";
  import LockScreen from "$components/main/auth/LockScreen.svelte";

  $: mode = $page.url.searchParams.get("mode") || "decrypt";
  $: lockType = $page.url.searchParams.get("type");
  $: from = $page.url.searchParams.get("from");
</script>

<LockScreen {mode} {lockType} {from} isOverlay={false} />
