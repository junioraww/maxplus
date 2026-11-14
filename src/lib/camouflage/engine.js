export function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createPrng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCIENTIFIC_ROW = ["(", ")", "√", "^"].map(id => ({ id, type: "sci" }));

export const BASE_CALC_KEYS = [
  "C:op", "±:op", "%:op", "÷:act",
  "7:num", "8:num", "9:num", "×:act",
  "4:num", "5:num", "6:num", "−:act",
  "1:num", "2:num", "3:num", "+:act",
  "0:num", ".:num", "back:op", "=:act eq"
].map(s => {
  const [id, type] = s.split(":");
  return { id, type };
});

function hslToHex(h, s, l) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const PALETTE_ARCHETYPES = [
  { name: "Midnight Orange", baseHue: 35, sat: 96, light: 52, bgHue: 0, oledProb: 0.5 },
  { name: "OneUI Emerald", baseHue: 152, sat: 72, light: 46, bgHue: 160, oledProb: 0.2 },
  { name: "Pixel Sky", baseHue: 199, sat: 92, light: 54, bgHue: 215, oledProb: 0.25 },
  { name: "Cyber Violet", baseHue: 255, sat: 85, light: 64, bgHue: 250, oledProb: 0.3 },
  { name: "Solar Amber", baseHue: 42, sat: 94, light: 50, bgHue: 30, oledProb: 0.35 },
  { name: "Obsidian Pearl", baseHue: 210, sat: 15, light: 88, bgHue: 220, oledProb: 0.6 },
  { name: "Nordic Cyan", baseHue: 190, sat: 92, light: 48, bgHue: 210, oledProb: 0.2 },
  { name: "Ruby Crimson", baseHue: 348, sat: 88, light: 54, bgHue: 340, oledProb: 0.3 },
  { name: "Forest Moss", baseHue: 135, sat: 65, light: 45, bgHue: 140, oledProb: 0.2 },
  { name: "Sunset Coral", baseHue: 12, sat: 90, light: 56, bgHue: 15, oledProb: 0.25 },
  { name: "Industrial Steel", baseHue: 215, sat: 20, light: 75, bgHue: 220, oledProb: 0.4 },
  { name: "Lavender Dusk", baseHue: 275, sat: 75, light: 62, bgHue: 270, oledProb: 0.3 }
];

const LOCALES = {
  ru: {
    notesTitles: ["Заметки", "Блокнот", "Мои записи", "Быстрые заметки"],
    notesBreadcrumbs: ["Личное хранилище", "Офлайн-режим", "Записи", "Синхронизировано"],
    notesCategories: ["Все", "Личные", "Идеи", "Архив"],
    notesSearch: "Поиск по заметкам...",
    notePlaceholderTitle: "Заголовок",
    notePlaceholderBody: "Текст заметки...",
    saveBtn: "Сохранить",
    cancelBtn: "Отмена",
    todoTitles: ["Задачи", "Список дел", "Мой день", "Планы"],
    todoBreadcrumbs: ["Продуктивность", "Сегодня", "Фокус", "План действий"],
    todoFilters: ["Все", "В работе", "Сделано"],
    todoInputPlaceholder: "Новая задача...",
    todoProgressLabel: "выполнено",
    convTitles: ["Конвертер", "Обмен валют", "Конвертер величин", "Калькулятор FX"],
    convBreadcrumbs: ["Финансы и меры", "Курсы валют", "Утилиты", "Быстрый пересчет"],
    convCategories: [
      { id: "currency", label: "Валюта" },
      { id: "length", label: "Длина" },
      { id: "weight", label: "Масса" },
      { id: "volume", label: "Объём" }
    ],
    convFrom: "Отдаёте",
    convTo: "Получаете",
    convBtn: "Конвертировать",
    calcErrors: ["Ошибка", "ERR: SYNTAX", "Ошибка ввода", "Не определено", "Деление на 0"]
  },
  en: {
    notesTitles: ["Notes", "Notebook", "My Notes", "Quick Memo"],
    notesBreadcrumbs: ["Personal Vault", "Offline Storage", "Drafts", "Synced"],
    notesCategories: ["All", "Personal", "Ideas", "Archive"],
    notesSearch: "Search notes...",
    notePlaceholderTitle: "Title",
    notePlaceholderBody: "Note content...",
    saveBtn: "Save",
    cancelBtn: "Cancel",
    todoTitles: ["Tasks", "To-Do List", "My Day", "Action Items"],
    todoBreadcrumbs: ["Productivity", "Today", "Daily Focus", "Action Plan"],
    todoFilters: ["All", "Pending", "Done"],
    todoInputPlaceholder: "Add a task...",
    todoProgressLabel: "completed",
    convTitles: ["Converter", "Currency Exchange", "Unit Converter", "FX Calculator"],
    convBreadcrumbs: ["Finance & Units", "Exchange Rates", "Utilities", "Quick Swap"],
    convCategories: [
      { id: "currency", label: "Currency" },
      { id: "length", label: "Length" },
      { id: "weight", label: "Weight" },
      { id: "volume", label: "Volume" }
    ],
    convFrom: "You Send",
    convTo: "You Get",
    convBtn: "Convert",
    calcErrors: ["Error", "ERR: SYNTAX", "Math Error", "Invalid Input", "Div by 0"]
  }
};

export function generateProceduralTheme(seed) {
  if (typeof window !== "undefined" && typeof window.__generateProceduralTheme === "function") {
    return window.__generateProceduralTheme(seed);
  }
  const rand = createPrng(seed);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const arch = pick(PALETTE_ARCHETYPES);

  const lang = rand() > 0.4 ? "ru" : "en";
  const loc = LOCALES[lang];

  const notesTitle = pick(loc.notesTitles);
  const notesBreadcrumb = pick(loc.notesBreadcrumbs);
  const todoTitle = pick(loc.todoTitles);
  const todoBreadcrumb = pick(loc.todoBreadcrumbs);
  const convTitle = pick(loc.convTitles);
  const convBreadcrumb = pick(loc.convBreadcrumbs);

  const headerStyle = pick(["classic-large", "compact-nav", "search-first", "split-breadcrumb"]);
  const notesLayout = pick(["card-grid", "list-compact", "notebook-lines"]);
  const todoLayout = pick(["cards", "minimal-list", "progress-header"]);
  const convLayout = pick(["cards", "compact-table", "dual-pane"]);
  const calcErrorText = pick(loc.calcErrors);

  const hueJitter = Math.round((rand() - 0.5) * 32);
  const accentHue = (arch.baseHue + hueJitter + 360) % 360;
  const accentSat = Math.max(35, Math.min(100, Math.round(arch.sat + (rand() - 0.5) * 20)));
  const accentLight = Math.max(40, Math.min(75, Math.round(arch.light + (rand() - 0.5) * 14)));
  const accent = hslToHex(accentHue, accentSat, accentLight);
  const accentFg = accentLight > 58 ? "#000000" : "#ffffff";

  const isOled = rand() < arch.oledProb;
  const bg = isOled ? "#000000" : hslToHex(arch.bgHue, Math.round(8 + rand() * 8), Math.round(5 + rand() * 4));
  const surface = hslToHex(arch.bgHue, Math.round(10 + rand() * 8), Math.round(11 + rand() * 4));
  const surface2 = hslToHex(arch.bgHue, Math.round(12 + rand() * 10), Math.round(17 + rand() * 5));
  const btnBg = hslToHex(arch.bgHue, Math.round(10 + rand() * 8), Math.round(14 + rand() * 5));
  const btnTopBg = hslToHex(arch.bgHue, Math.round(12 + rand() * 10), Math.round(22 + rand() * 6));
  const btnOpBg = rand() > 0.3 ? accent : hslToHex(accentHue, Math.round(accentSat * 0.9), Math.round(accentLight * 0.88));
  const border = `rgba(255, 255, 255, ${(0.05 + rand() * 0.08).toFixed(2)})`;
  const text = hslToHex(arch.bgHue, 8, Math.round(94 + rand() * 5));
  const textDim = hslToHex(arch.bgHue, 12, Math.round(58 + rand() * 10));

  const btnRadius = pick(["4px", "6px", "8px", "10px", "12px", "14px"]);
  const cardRadius = pick(["8px", "10px", "12px", "14px"]);
  const gap = pick(["6px", "8px", "10px", "12px"]);
  const font = pick([
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
    'Inter, system-ui, sans-serif',
    '"JetBrains Mono", Menlo, Consolas, monospace'
  ]);

  const calcLayout = pick(["standard", "scientific", "toolbar", "sunken-lcd"]);
  const displayAlign = pick(["right", "center", "left"]);
  const displayWeight = pick([300, 400, 600, 700]);
  const btnShadow = rand() > 0.6 ? `0 2px 6px rgba(0, 0, 0, ${(0.2 + rand() * 0.25).toFixed(2)})` : "none";

  const animType = pick(["none", "fade", "scale", "slide"]);
  const animDuration = pick(["0.18s", "0.22s", "0.26s"]);
  const animTiming = pick(["cubic-bezier(0.16, 1, 0.3, 1)", "ease-out", "cubic-bezier(0.2, 0.8, 0.2, 1)"]);
  const calcErrorColor = pick(["#ef4444", "#f87171", "#fb923c", "#f43f5e"]);

  return {
    seed,
    archetypeName: arch.name,
    lang,
    notesTitle,
    notesBreadcrumb,
    notesCategories: loc.notesCategories,
    notesSearch: loc.notesSearch,
    notePlaceholderTitle: loc.notePlaceholderTitle,
    notePlaceholderBody: loc.notePlaceholderBody,
    saveBtn: loc.saveBtn,
    cancelBtn: loc.cancelBtn,
    headerStyle,
    notesLayout,
    hasMockToolbar: rand() > 0.45,
    calcLayout,
    displayAlign,
    displayWeight,
    todoTitle,
    todoBreadcrumb,
    todoFilters: loc.todoFilters,
    todoInputPlaceholder: loc.todoInputPlaceholder,
    todoProgressLabel: loc.todoProgressLabel,
    todoLayout,
    todoStyle: pick(["card", "minimal", "grouped"]),
    convLayout,
    convTitle,
    convBreadcrumb,
    convCategories: loc.convCategories,
    convFrom: loc.convFrom,
    convTo: loc.convTo,
    convBtn: loc.convBtn,
    calcErrorText,
    calcErrorColor,
    animType,
    animDuration,
    animTiming,
    btnRadius,
    cardRadius,
    gap,
    font,
    iconSvg: generateProceduralIconSvg(seed),
    cssVars: {
      "--camo-bg": bg,
      "--camo-surface": surface,
      "--camo-surface2": surface2,
      "--camo-text": text,
      "--camo-text-dim": textDim,
      "--camo-accent": accent,
      "--camo-accent-fg": accentFg,
      "--camo-btn-bg": btnBg,
      "--camo-btn-op-bg": btnOpBg,
      "--camo-btn-op-fg": accentFg,
      "--camo-btn-top-bg": btnTopBg,
      "--camo-btn-shadow": btnShadow,
      "--camo-border": border,
      "--camo-radius": btnRadius,
      "--camo-card-radius": cardRadius,
      "--camo-gap": gap,
      "--camo-font": font,
      "--camo-display-align": displayAlign === "right" ? "flex-end" : displayAlign === "left" ? "flex-start" : "center",
      "--camo-display-weight": String(displayWeight),
      "--camo-anim-duration": animDuration,
      "--camo-anim-timing": animTiming,
      "--camo-error-color": calcErrorColor
    }
  };
}

export function evaluateMath(expr, errorText = "Ошибка") {
  try {
    const clean = expr
      .replace(/×/g, "*")
      .replace(/÷/g, "/")
      .replace(/−/g, "-")
      .replace(/√(\d+(\.\d+)?)/g, "Math.sqrt($1)")
      .replace(/\^/g, "**")
      .replace(/%/g, "*0.01")
      .replace(/[^-()\d/*+.]/g, "");
    if (!clean) return "0";
    const result = Function(`"use strict"; return (${clean})`)();
    if (!isFinite(result) || isNaN(result)) return errorText;
    const rounded = Number(Math.round(Number(result + "e+8")) + "e-8");
    return String(rounded);
  } catch {
    return errorText;
  }
}

const ICON_VIBRANT = [
  "#2563EB", "#0284C7", "#0D9488", "#059669", "#16A34A",
  "#65A30D", "#D97706", "#EA580C", "#DC2626", "#E11D48",
  "#C026D3", "#9333EA", "#7C3AED", "#4F46E5", "#0891B2"
];

const ICON_GRADIENTS = [
  ["#4F46E5", "#7C3AED"], ["#06B6D4", "#3B82F6"], ["#F43F5E", "#FB7185"],
  ["#10B981", "#059669"], ["#F59E0B", "#EA580C"], ["#8B5CF6", "#EC4899"],
  ["#0EA5E9", "#2563EB"], ["#14B8A6", "#0D9488"], ["#6366F1", "#A855F7"],
  ["#27272A", "#09090B"]
];

const ICON_DARK = ["#141519", "#181A20", "#1A1D24", "#0F1115", "#16171B", "#1C1D24"];
const ICON_LIGHT = ["#FFFFFF", "#F8F9FA", "#F3F4F6", "#EDEFEF", "#E5E7EB"];
const ICON_RADII = [16, 22, 26, 32, 54];

const ICON_GLYPHS = [
  c => `<polygon points="54,22 63,42 85,44 68,59 73,81 54,69 35,81 40,59 23,44 45,42" fill="${c}"/>`,
  c => `<path d="M38 70L70 38M70 38L64 32M70 38L76 44" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/><path d="M34 74C37 74 39 72 39 69L38 70H34V74Z" fill="${c}"/>`,
  c => `<circle cx="54" cy="54" r="30" stroke="${c}" stroke-width="3"/><polygon points="54,34 62,54 54,48 46,54" fill="${c}"/><polygon points="54,74 62,54 54,60 46,54" fill="${c}" opacity="0.6"/>`,
  c => `<path d="M54 24C54 40 40 54 24 54C40 54 54 68 54 84C54 68 68 54 84 54C68 54 54 40 54 24Z" fill="${c}"/>`,
  c => `<polygon points="58,22 36,54 52,54 46,86 72,50 56,50" fill="${c}"/>`,
  c => `<path d="M54 24L32 34V52C32 68 42 79 54 84C66 79 76 68 76 52V34L54 24Z" stroke="${c}" stroke-width="3" fill="none"/>`,
  c => `<polygon points="34,34 74,34 84,48 54,84 24,48" stroke="${c}" stroke-width="3" fill="none"/><line x1="24" y1="48" x2="84" y2="48" stroke="${c}" stroke-width="2.5"/><line x1="44" y1="34" x2="54" y2="84" stroke="${c}" stroke-width="2"/><line x1="64" y1="34" x2="54" y2="84" stroke="${c}" stroke-width="2"/>`,
  c => `<path d="M54 22C54 22 66 38 66 52C66 68 54 82 54 82C54 82 42 68 42 52C42 42 48 32 54 22Z" fill="${c}"/><path d="M54 44C54 44 60 52 60 60C60 68 54 74 54 74C54 74 48 68 48 60C48 54 51 48 54 44Z" fill="#FFF" opacity="0.5"/>`,
  c => `<ellipse cx="54" cy="54" rx="32" ry="12" stroke="${c}" stroke-width="2.5" transform="rotate(30 54 54)"/><ellipse cx="54" cy="54" rx="32" ry="12" stroke="${c}" stroke-width="2.5" transform="rotate(-30 54 54)"/><ellipse cx="54" cy="54" rx="32" ry="12" stroke="${c}" stroke-width="2.5" transform="rotate(90 54 54)"/><circle cx="54" cy="54" r="5" fill="${c}"/>`,
  c => `<path d="M54 24L80 38V68L54 84L28 68V38L54 24Z" stroke="${c}" stroke-width="3" fill="none"/><line x1="54" y1="24" x2="54" y2="84" stroke="${c}" stroke-width="2.5"/><line x1="54" y1="54" x2="80" y2="38" stroke="${c}" stroke-width="2.5"/><line x1="54" y1="54" x2="28" y2="38" stroke="${c}" stroke-width="2.5"/>`,
  c => `<circle cx="54" cy="54" r="30" stroke="${c}" stroke-width="3"/><ellipse cx="54" cy="54" rx="14" ry="30" stroke="${c}" stroke-width="2"/><line x1="24" y1="54" x2="84" y2="54" stroke="${c}" stroke-width="2"/>`,
  c => `<path d="M54 22C54 22 74 46 74 62C74 74 65 84 54 84C43 84 34 74 34 62C34 46 54 22 54 22Z" fill="${c}"/>`,
  c => `<circle cx="42" cy="48" r="14" stroke="${c}" stroke-width="3.5"/><line x1="52" y1="56" x2="78" y2="76" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/><line x1="68" y1="68" x2="74" y2="62" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/><line x1="74" y1="73" x2="80" y2="67" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`,
  c => `<circle cx="54" cy="54" r="14" stroke="${c}" stroke-width="3"/><path d="M50 24H58V32H50V24ZM50 76H58V84H50V76ZM24 50H32V58H24V50ZM76 50H84V58H76V50ZM34 34L40 40L34 46L28 40L34 34ZM74 74L80 80L74 86L68 80L74 74ZM34 74L28 80L34 86L40 80L34 74ZM74 34L68 40L74 46L80 40L74 34Z" fill="${c}"/>`,
  c => `<path d="M34 74C34 74 38 42 74 34C74 34 70 66 34 74Z" fill="${c}"/><line x1="34" y1="74" x2="62" y2="46" stroke="#FFF" stroke-width="2"/>`,
  c => `<path d="M36 24H72V84L54 70L36 84V24Z" fill="${c}"/>`,
  c => `<path d="M48 42V68C48 74 58 74 58 68V34C58 24 40 24 40 34V68C40 80 66 80 66 68V42" stroke="${c}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`,
  c => `<rect x="24" y="34" width="60" height="46" rx="8" stroke="${c}" stroke-width="3" fill="none"/><circle cx="54" cy="57" r="14" stroke="${c}" stroke-width="3"/><path d="M42 34L46 26H62L66 34" stroke="${c}" stroke-width="2.5"/>`,
  c => `<circle cx="54" cy="54" r="30" stroke="${c}" stroke-width="3"/><polyline points="54,34 54,54 68,54" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`,
  c => `<rect x="28" y="26" width="52" height="56" rx="6" stroke="${c}" stroke-width="3" fill="none"/><line x1="40" y1="26" x2="40" y2="82" stroke="${c}" stroke-width="2.5"/><line x1="48" y1="42" x2="70" y2="42" stroke="${c}" stroke-width="2"/><line x1="48" y1="54" x2="70" y2="54" stroke="${c}" stroke-width="2"/>`,
  c => `<circle cx="48" cy="48" r="18" stroke="${c}" stroke-width="3.5" fill="none"/><line x1="62" y1="62" x2="82" y2="82" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>`,
  c => `<polygon points="54,24 82,78 26,78" stroke="${c}" stroke-width="3.5" stroke-linejoin="round" fill="none"/><line x1="54" y1="24" x2="54" y2="78" stroke="${c}" stroke-width="2"/>`,
  c => `<path d="M40 54C34 48 34 38 42 30C50 22 62 24 66 32C70 40 66 48 62 54V62H40V54Z" stroke="${c}" stroke-width="3" fill="none"/><line x1="44" y1="68" x2="58" y2="68" stroke="${c}" stroke-width="3"/><line x1="48" y1="74" x2="54" y2="74" stroke="${c}" stroke-width="3"/>`,
  c => `<polygon points="54,20 62,46 88,54 62,62 54,88 46,62 20,54 46,46" fill="${c}"/>`,
  c => `<polygon points="26,74 82,74 78,40 62,56 54,32 46,56 30,40" fill="${c}"/>`,
  c => `<rect x="26" y="26" width="56" height="56" rx="12" stroke="${c}" stroke-width="3" fill="none"/><circle cx="42" cy="42" r="3.5" fill="${c}"/><circle cx="66" cy="42" r="3.5" fill="${c}"/><circle cx="54" cy="54" r="3.5" fill="${c}"/><circle cx="42" cy="66" r="3.5" fill="${c}"/><circle cx="66" cy="66" r="3.5" fill="${c}"/>`,
  c => `<rect x="24" y="28" width="60" height="52" rx="8" stroke="${c}" stroke-width="3" fill="none"/><polyline points="34,44 42,52 34,60" stroke="${c}" stroke-width="3" stroke-linecap="round"/><line x1="48" y1="60" x2="60" y2="60" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
  c => `<path d="M38 42C48 42 60 66 70 66C76 66 80 60 80 54C80 48 76 42 70 42C60 42 48 66 38 66C32 66 28 60 28 54C28 48 32 42 38 42Z" stroke="${c}" stroke-width="4" fill="none"/>`,
  c => `<circle cx="54" cy="54" r="16" fill="${c}"/><path d="M54 22V28M54 80V86M22 54H28M80 54H86M32 32L36 36M72 72L76 76M32 76L36 72M72 36L76 32" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`,
  c => `<rect x="24" y="24" width="60" height="60" rx="8" stroke="${c}" stroke-width="3" fill="none"/><line x1="24" y1="44" x2="84" y2="44" stroke="${c}" stroke-width="2"/><line x1="24" y1="64" x2="84" y2="64" stroke="${c}" stroke-width="2"/><circle cx="38" cy="44" r="4" fill="${c}"/><circle cx="50" cy="44" r="4" fill="${c}"/><circle cx="68" cy="64" r="4" fill="${c}"/>`,
  c => `<path d="M34 26H74L58 54L74 82H34L50 54L34 26Z" stroke="${c}" stroke-width="3" fill="none"/><polygon points="48,68 60,68 54,60" fill="${c}"/>`,
  c => `<polygon points="24,50 84,24 58,84 48,58" fill="${c}"/>`,
  c => `<rect x="26" y="32" width="56" height="52" rx="8" stroke="${c}" stroke-width="3" fill="none"/><line x1="26" y1="46" x2="82" y2="46" stroke="${c}" stroke-width="3"/><line x1="38" y1="24" x2="38" y2="34" stroke="${c}" stroke-width="3"/><line x1="70" y1="24" x2="70" y2="34" stroke="${c}" stroke-width="3"/><circle cx="42" cy="58" r="2.5" fill="${c}"/><circle cx="54" cy="58" r="2.5" fill="${c}"/><circle cx="66" cy="58" r="2.5" fill="${c}"/>`,
  c => `<rect x="28" y="32" width="52" height="54" rx="6" stroke="${c}" stroke-width="3" fill="none"/><rect x="42" y="24" width="24" height="12" rx="3" fill="${c}"/><line x1="38" y1="48" x2="70" y2="48" stroke="${c}" stroke-width="2.5"/><line x1="38" y1="60" x2="70" y2="60" stroke="${c}" stroke-width="2.5"/><line x1="38" y1="72" x2="58" y2="72" stroke="${c}" stroke-width="2.5"/>`
];

export function generateProceduralIconSvg(seed) {
  const rand = createPrng(seed ^ 0x5f359);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const glyphFn = pick(ICON_GLYPHS);
  const archRoll = rand();
  const rx = pick(ICON_RADII);

  let body = "";
  if (archRoll < 0.16) {
    const bg = rand() < 0.5 ? "#000000" : pick(ICON_DARK);
    body = `<rect width="108" height="108" rx="${rx}" fill="${bg}"/>${glyphFn("#FFFFFF")}`;
  } else if (archRoll < 0.3) {
    const bg = pick(ICON_LIGHT);
    const gc = rand() < 0.6 ? "#090A0D" : "#18181B";
    body = `<rect width="108" height="108" rx="${rx}" fill="${bg}"/>${glyphFn(gc)}`;
  } else if (archRoll < 0.56) {
    body = `<rect width="108" height="108" rx="${rx}" fill="${pick(ICON_VIBRANT)}"/>${glyphFn("#FFFFFF")}`;
  } else if (archRoll < 0.72) {
    const bg = pick(ICON_DARK);
    const h = Math.floor(rand() * 360);
    body = `<rect width="108" height="108" rx="${rx}" fill="${bg}"/>${glyphFn(hslToHex(h, Math.floor(75 + rand() * 25), Math.floor(55 + rand() * 15)))}`;
  } else if (archRoll < 0.86) {
    const [c1, c2] = pick(ICON_GRADIENTS);
    const gradId = `g_${(seed ^ 0x1337) & 0xffff}`;
    body = `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="108" height="108" rx="${rx}" fill="url(#${gradId})"/>${glyphFn("#FFFFFF")}`;
  } else if (archRoll < 0.96) {
    const hasBorder = rand() < 0.55;
    const h = Math.floor(rand() * 360);
    const bc = rand() < 0.7 ? hslToHex(h, Math.floor(75 + rand() * 25), Math.floor(50 + rand() * 20)) : "#FFFFFF";
    const border = hasBorder ? `<rect x="3" y="3" width="102" height="102" rx="${rx}" stroke="${bc}" stroke-width="2.5" fill="none" opacity="0.7"/>` : "";
    body = `${border}${glyphFn(bc)}`;
  } else {
    const h = Math.floor(rand() * 360);
    const gc = hslToHex(h, 85, 55);
    body = `<rect width="108" height="108" rx="${rx}" fill="#121316"/><rect x="14" y="14" width="80" height="80" rx="${Math.max(4, rx - 4)}" fill="#1C1D24" opacity="0.6"/><circle cx="54" cy="54" r="34" stroke="${gc}" stroke-width="1.5" opacity="0.3"/>${glyphFn(gc)}`;
  }

  return `<svg width="108" height="108" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export function renderIconToRgba(svgString, size = 128) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.document) {
      return reject(new Error("window is not available"));
    }
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return reject(new Error("canvas context unavailable"));

    const img = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const imgData = ctx.getImageData(0, 0, size, size);
      const dataUrl = canvas.toDataURL("image/png");
      const pngBase64 = dataUrl.split(",")[1] || "";
      resolve({
        rgba: Array.from(imgData.data),
        pngBase64,
        width: size,
        height: size
      });
    };
    img.onerror = e => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
