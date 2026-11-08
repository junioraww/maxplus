<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { activeThemeId } from "$lib/stores/theme";

  export let selectedCode = "+7";

  const dispatch = createEventDispatcher();
  let query = "";
  let searchInput;
  let sheetEl;

  let isDragging = false;
  let startY = 0;
  let currentY = 0;
  let dragOffset = 0;
  let isExpanded = false;

  const COUNTRIES = [
    { name: "Россия", code: "+7", flag: "🇷🇺", mask: "### ### ## ##" },
    { name: "Беларусь", code: "+375", flag: "🇧🇾", mask: "## ### ## ##" },
    { name: "Азербайджан", code: "+994", flag: "🇦🇿", mask: "## ### ## ##" },
    { name: "Армения", code: "+374", flag: "🇦🇲", mask: "## ### ###" },
    { name: "Афганистан", code: "+93", flag: "🇦🇫", mask: "## ### ####" },
    { name: "Боливия", code: "+591", flag: "🇧🇴", mask: "# ### ####" },
    { name: "Бразилия", code: "+55", flag: "🇧🇷", mask: "## ##### ####" },
    { name: "Венесуэла", code: "+58", flag: "🇻🇪", mask: "### ### ####" },
    { name: "Вьетнам", code: "+84", flag: "🇻🇳", mask: "## #### ####" },
    { name: "Гамбия", code: "+220", flag: "🇬🇲", mask: "### ####" },
    { name: "Гренада", code: "+1", flag: "🇬🇩", mask: "473 ### ####" },
    { name: "Грузия", code: "+995", flag: "🇬🇪", mask: "### ## ## ##" },
    { name: "Египет", code: "+20", flag: "🇪🇬", mask: "### ### ####" },
    { name: "Индия", code: "+91", flag: "🇮🇳", mask: "##### #####" },
    { name: "Индонезия", code: "+62", flag: "🇮🇩", mask: "### #### ####" },
    { name: "Ирак", code: "+964", flag: "🇮🇶", mask: "### ### ####" },
    { name: "Казахстан", code: "+7", flag: "🇰🇿", mask: "### ### ## ##" },
    { name: "Камбоджа", code: "+855", flag: "🇰🇭", mask: "## ### ###" },
    { name: "Катар", code: "+974", flag: "🇶🇦", mask: "#### ####" },
    { name: "Китай", code: "+86", flag: "🇨🇳", mask: "### #### ####" },
    { name: "Колумбия", code: "+57", flag: "🇨🇴", mask: "### ### ####" },
    { name: "Конго - Браззавиль", code: "+242", flag: "🇨🇬", mask: "## ### ####" },
    { name: "Конго - Киншаса", code: "+243", flag: "🇨🇩", mask: "### ### ###" },
    { name: "Куба", code: "+53", flag: "🇨🇺", mask: "# ### ####" },
    { name: "Кувейт", code: "+965", flag: "🇰🇼", mask: "#### ####" },
    { name: "Кыргызстан", code: "+996", flag: "🇰🇬", mask: "### ### ###" },
    { name: "Лаос", code: "+856", flag: "🇱🇦", mask: "## ## ### ###" },
    { name: "Ливан", code: "+961", flag: "🇱🇧", mask: "# ### ###" },
    { name: "Малайзия", code: "+60", flag: "🇲🇾", mask: "## ### ####" },
    { name: "Молдова", code: "+373", flag: "🇲🇩", mask: "#### ####" },
    { name: "Мьянма (Бирма)", code: "+95", flag: "🇲🇲", mask: "## ### ####" },
    { name: "Никарагуа", code: "+505", flag: "🇳🇮", mask: "#### ####" },
    { name: "ОАЭ", code: "+971", flag: "🇦🇪", mask: "## ### ####" },
    { name: "Пакистан", code: "+92", flag: "🇵🇰", mask: "### #######" },
    { name: "Палау", code: "+680", flag: "🇵🇼", mask: "### ####" },
    { name: "Саудовская Аравия", code: "+966", flag: "🇸🇦", mask: "## ### ####" },
    { name: "Сент-Китс и Невис", code: "+1", flag: "🇰🇳", mask: "869 ### ####" },
    { name: "Таджикистан", code: "+992", flag: "🇹🇯", mask: "## ### ####" },
    { name: "Таиланд", code: "+66", flag: "🇹🇭", mask: "## #### ####" },
    { name: "Танзания", code: "+255", flag: "🇹🇿", mask: "### ### ###" },
    { name: "Туркменистан", code: "+993", flag: "🇹🇲", mask: "## ######" },
    { name: "Турция", code: "+90", flag: "🇹🇷", mask: "### ### ## ##" },
    { name: "Узбекистан", code: "+998", flag: "🇺🇿", mask: "## ### ## ##" },
    { name: "Южно-Африканская Республика", code: "+27", flag: "🇿🇦", mask: "## ### ####" },
  ];

  $: filtered = COUNTRIES.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.code.includes(q) ||
      c.code.replace("+", "").includes(q)
    );
  });

  onMount(() => {
    if (searchInput) searchInput.focus();
  });

  function selectCountry(country) {
    dispatch("select", country);
  }

  function close() {
    dispatch("close");
  }

  function handleKeydown(e) {
    if (e.key === "Escape") close();
  }

  function onHandlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    isDragging = true;
    startY = e.clientY;
    currentY = e.clientY;
    dragOffset = 0;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }

  function onHandlePointerMove(e) {
    if (!isDragging) return;
    currentY = e.clientY;
    const delta = currentY - startY;

    if (delta > 0) {
      dragOffset = delta;
    } else {
      dragOffset = Math.max(-200, delta);
    }
  }

  function onHandlePointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const delta = currentY - startY;

    if (delta > 100) {
      close();
    } else if (delta < -30) {
      isExpanded = true;
      dragOffset = 0;
    } else if (isExpanded && delta > 40) {
      isExpanded = false;
      dragOffset = 0;
    } else {
      dragOffset = 0;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  class="backdrop"
  class:dark-theme={$activeThemeId === "dark"}
  in:fade={{ duration: 160 }}
  out:fade={{ duration: 160 }}
  on:click={close}
>
  <div
    bind:this={sheetEl}
    class="sheet"
    class:dragging={isDragging}
    class:expanded={isExpanded}
    style="transform: translate3d(0, {Math.max(0, dragOffset)}px, 0); height: {dragOffset < 0 ? `calc(${isExpanded ? '100vh - var(--safe-top, 0px) - 8px' : '78vh'} + ${-dragOffset}px)` : ''};"
    on:click|stopPropagation
  >
    <div
      class="drag-handle-bar"
      on:pointerdown={onHandlePointerDown}
      on:pointermove={onHandlePointerMove}
      on:pointerup={onHandlePointerUp}
      on:pointercancel={onHandlePointerUp}
    >
      <div class="drag-handle"></div>
    </div>

    <div class="search-box">
      <input
        bind:this={searchInput}
        bind:value={query}
        type="text"
        class="search-input"
        placeholder="Найти страну"
      />
    </div>

    <div class="country-list">
      {#each filtered as country (country.name + country.code)}
        <button
          type="button"
          class="country-item"
          class:selected={country.code === selectedCode && (country.code !== '+7' || country.name === 'Россия')}
          on:click={() => selectCountry(country)}
        >
          <span class="flag">{country.flag}</span>
          <span class="name">{country.name}</span>
          <span class="code">{country.code}</span>
        </button>
      {/each}
      {#if filtered.length === 0}
        <div class="empty">Страна не найдена</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: 100vw;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow-x: hidden;
  }

  .sheet {
    background: #ffffff;
    border-radius: 20px 20px 0 0;
    width: 100%;
    max-width: 100vw;
    height: 78vh;
    max-height: calc(100vh - var(--safe-top, 0px) - 10px);
    display: flex;
    flex-direction: column;
    padding-bottom: max(16px, var(--safe-bottom, 0px));
    box-shadow: 0 -4px 28px rgba(0, 0, 0, 0.18);
    transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), height 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
    will-change: transform, height;
    box-sizing: border-box;
    color: #000000;
    overflow-x: hidden;
  }

  .sheet.dragging {
    transition: none;
  }

  .sheet.expanded {
    height: calc(100vh - var(--safe-top, 0px) - 8px);
  }

  .drag-handle-bar {
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 12px 0 10px 0;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .drag-handle-bar:active {
    cursor: grabbing;
  }

  .drag-handle {
    width: 40px;
    height: 4px;
    background: #d1d1d6;
    border-radius: 2px;
  }

  .search-box {
    padding: 6px 16px 12px 16px;
    flex-shrink: 0;
  }

  .search-input {
    width: 100%;
    height: 46px;
    padding: 0 16px;
    border-radius: 12px;
    border: none;
    outline: none;
    background: #eff0f4;
    color: #000000;
    font-size: 16px;
    font-family: inherit;
    box-sizing: border-box;
  }

  .search-input::placeholder {
    color: #8e8e93;
  }

  .country-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    min-height: 0;
  }

  .country-item {
    display: flex;
    align-items: center;
    height: 52px;
    min-height: 52px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    padding: 0 8px;
    cursor: pointer;
    text-align: left;
    border-radius: 10px;
    transition: background-color 0.1s ease;
  }

  .country-item:active {
    background: #f2f2f7;
  }

  .flag {
    font-size: 24px;
    margin-right: 14px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 500;
    color: #000000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .code {
    font-size: 16px;
    font-weight: 400;
    color: #8e8e93;
    flex-shrink: 0;
    margin-left: 12px;
  }

  .empty {
    padding: 36px 0;
    text-align: center;
    color: #8e8e93;
    font-size: 15px;
  }

  .backdrop.dark-theme .sheet {
    background: #1c1d22;
    color: #ffffff;
  }

  .backdrop.dark-theme .drag-handle {
    background: #505260;
  }

  .backdrop.dark-theme .search-input {
    background: #282932;
    color: #ffffff;
  }

  .backdrop.dark-theme .name {
    color: #ffffff;
  }

  .backdrop.dark-theme .country-item:active {
    background: #252630;
  }
</style>
