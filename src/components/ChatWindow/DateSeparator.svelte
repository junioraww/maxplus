<script>
  export let msg;

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function formatMessageDate(unixTime) {
    const date = new Date(unixTime);
    const now = new Date();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";

    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    }
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
</script>

<div class="date-separator">
  <a>{formatMessageDate(msg.time)}</a>
</div>

<style>
  .date-separator {
    text-align: center;
    margin: 8px 0 16px 0;
    color: var(--text-muted);
    position: relative;
  }

  .date-separator a {
    padding: 4px 16px;
    border-radius: 100px;
    background-color: #fff2;
    font-size: 13px;
    font-weight: 500;
  }
</style>
