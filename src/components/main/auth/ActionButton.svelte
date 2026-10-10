<script>
  import { onMount } from "svelte";
  import { Button } from "$components/ui";

  export let action;
  export let text;

  let loading = false;

  async function click() {
    if (loading) return;
    loading = true;
    try {
      await action();
    } catch (e) {
      console.error(e);
      alert(e);
    } finally {
      setTimeout(() => (loading = false), 400);
    }
  }

  onMount(() => {
    const handler = (e) => {
      if (e.key === "Enter") click();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });
</script>

<Button variant="primary" size="lg" full {loading} onclick={click}>{text}</Button>
