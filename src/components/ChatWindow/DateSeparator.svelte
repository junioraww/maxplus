<script>
  export let msg;

  const SHORT_MONTHS = [
    "янв.", "февр.", "марта", "апр.", "мая", "июня",
    "июля", "авг.", "сент.", "окт.", "нояб.", "дек."
  ];

  function formatMessageDate(unixTime) {
    if (!unixTime) return "";
    const date = new Date(unixTime);
    const now = new Date();

    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (isToday) {
      return "Сегодня";
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate();

    if (isYesterday) {
      return "Вчера";
    }

    const day = date.getDate();
    const month = SHORT_MONTHS[date.getMonth()] || "";
    const isCurrentYear = date.getFullYear() === now.getFullYear();

    if (isCurrentYear) {
      return `${day} ${month}`;
    } else {
      return `${day} ${month} ${date.getFullYear()}`;
    }
  }
</script>

<div class="date-separator">
  <span class="date-pill">{formatMessageDate(msg?.time)}</span>
</div>

<style>
  .date-separator {
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 4px 0 8px 0;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    z-index: 1;
  }

  .date-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--msg-system-padding, 2px 10px);
    border-radius: var(--msg-system-radius, 11px);
    background: var(--msg-system-bg, rgba(40, 44, 66, 0.70));
    color: var(--msg-system-text, #ffffff);
    min-height: 22px;
    box-sizing: border-box;
    font-size: var(--msg-system-font-size, 12px);
    font-weight: 400;
    line-height: 1.2;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    letter-spacing: 0.1px;
    text-align: center;
  }
</style>
