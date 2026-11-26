const SHORT_MONTHS = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatHm(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatMs(ms) {
  const d = new Date(ms);

  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();

  return `${day}.${month}.${year} в ${formatHm(d)}`;
}

const getForm = (n, forms) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
};

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatTimeAgo(time, now = Date.now()) {
  if (time === 0) return "давно";
  if (!time) return "неизвестно";

  let t = +time;
  if (!Number.isFinite(t) || t <= 0) return "давно";
  if (t < 1e12) t *= 1000;

  let diffMs = now - t;
  if (diffMs < 0) diffMs = 0;

  if (diffMs < 60_000) return "только что";

  const seenDate = new Date(t);
  const nowDate = new Date(now);
  const sameDay = isSameDay(seenDate, nowDate);

  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins} ${getForm(mins, ["минуту", "минуты", "минут"])} назад`;
  }

  if (sameDay && diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    return `${hours} ${getForm(hours, ["час", "часа", "часов"])} назад`;
  }

  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);
  if (isSameDay(seenDate, yesterday)) {
    return `вчера в ${formatHm(seenDate)}`;
  }

  const monthName = SHORT_MONTHS[seenDate.getMonth()];
  if (seenDate.getFullYear() === nowDate.getFullYear()) {
    return `${seenDate.getDate()} ${monthName} в ${formatHm(seenDate)}`;
  }

  return `${seenDate.getDate()} ${monthName} ${seenDate.getFullYear()} в ${formatHm(seenDate)}`;
}
