<script>
  import { now } from "$lib/stores/session";
  import { formatTimeAgo } from "$lib/utils/time";

  export let unixTime;

  $: text = formatTimeAgo(unixTime, $now);
</script>

{text}
