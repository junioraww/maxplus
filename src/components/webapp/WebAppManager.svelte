<script>
  import { activeWebApps } from "$lib/stores/webapp.js";
  import WebAppSheet from "./WebAppSheet.svelte";
  import WebAppMinimizedDock from "./WebAppMinimizedDock.svelte";
</script>

{#each $activeWebApps as app (app.id)}
  <WebAppSheet {app} />
{/each}

<WebAppMinimizedDock />
