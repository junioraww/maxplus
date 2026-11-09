<script>
  import { page } from "$app/stores";
  import LockScreen from "$components/main/auth/LockScreen.svelte";

  let mode = $page.url.searchParams.get("mode") || "decrypt";
  let lockType = $page.url.searchParams.get("type") || null;
  let from = $page.url.searchParams.get("from") || null;

  $: mode = $page.url.searchParams.get("mode") || "decrypt";
  $: lockType = $page.url.searchParams.get("type") || null;
  $: from = $page.url.searchParams.get("from") || null;
</script>

<LockScreen {mode} {lockType} {from} isOverlay={false} />
