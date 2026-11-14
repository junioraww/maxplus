<script>
  import "$lib/camouflage/camouflage.css";
  import { createEventDispatcher, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    camouflageSettings,
    activeProceduralTheme,
    pluginCustomApps,
    verifyAndUnlockCamouflage
  } from "$lib/camouflage/store";
  import {
    evaluateMath,
    BASE_CALC_KEYS,
    SCIENTIFIC_ROW
  } from "$lib/camouflage/engine";
  import CamoDropout from "./CamoDropout.svelte";

  export let isPreview = false;

  const dispatch = createEventDispatcher();

  $: theme = $activeProceduralTheme;
  $: cssStyleString = Object.entries(theme?.cssVars || {})
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

  let calcExpr = (typeof window !== "undefined" && window.__CAMO_STATE__?.calcExpr) || "0";
  let calcPrev = (typeof window !== "undefined" && window.__CAMO_STATE__?.calcPrev) || "";
  let calcJustEvaluated = false;
  let rawDigits = (typeof window !== "undefined" && window.__CAMO_STATE__?.rawDigits) || "";
  let displayTapCount = 0;
  let lastTapTime = 0;

  $: isErrorExpr =
    Boolean(theme?.calcErrorText && calcExpr === theme.calcErrorText) ||
    calcExpr.includes("ERR") ||
    calcExpr.includes("Error") ||
    calcExpr.includes("Ошибка") ||
    calcExpr.includes("Invalid");

  function tryUnlock(val) {
    const pin = String($camouflageSettings.pin || "0000").trim();
    const target = String(val ?? "").trim();
    if (target === pin || rawDigits === pin) {
      if (isPreview) {
        dispatch("previewUnlock");
        return true;
      }
      verifyAndUnlockCamouflage(pin);
      return true;
    }
    return false;
  }

  let containerEl = null;

  onMount(() => {
    requestAnimationFrame(() => {
      const instantRoot = typeof document !== "undefined" ? document.getElementById("camo-instant-root") : null;
      if (instantRoot) {
        instantRoot.remove();
      }
      if (containerEl && !isPreview && typeof window !== "undefined") {
        invoke("save_camouflage_shell", { html: containerEl.innerHTML }).catch(() => {});
      }
    });
    if (typeof window !== "undefined") {
      window.__CAMO_DIRECT_UNLOCK__ = () => {
        tryUnlock($camouflageSettings.pin || "0000");
      };
      if (window.__CAMO_UNLOCKED__) {
        tryUnlock($camouflageSettings.pin || "0000");
      }
    }
  });

  $: if (containerEl && !isPreview && typeof window !== "undefined" && ($camouflageSettings.appType || $activeProceduralTheme)) {
    requestAnimationFrame(() => {
      if (containerEl) {
        invoke("save_camouflage_shell", { html: containerEl.innerHTML }).catch(() => {});
      }
    });
  }

  function handleDisplaySecretTap() {
    const now = Date.now();
    if (now - lastTapTime < 500) {
      displayTapCount++;
      if (displayTapCount >= 3) {
        displayTapCount = 0;
        tryUnlock($camouflageSettings.pin || "0000");
      }
    } else {
      displayTapCount = 1;
    }
    lastTapTime = now;
  }

  function handleCalcPress(val) {
    if (val >= "0" && val <= "9") {
      rawDigits = (rawDigits + val).slice(-4);
      if (rawDigits === String($camouflageSettings.pin || "0000").trim()) {
        tryUnlock(rawDigits);
        return;
      }
    } else if (val === "C" || val === "back") {
      rawDigits = "";
    }

    if (val === "C") {
      calcExpr = "0";
      calcPrev = "";
      calcJustEvaluated = false;
      return;
    }
    if (val === "back") {
      if (isErrorExpr || calcExpr.length <= 1) calcExpr = "0";
      else calcExpr = calcExpr.slice(0, -1);
      return;
    }
    if (val === "±") {
      if (isErrorExpr) {
        calcExpr = "0";
        return;
      }
      if (calcExpr.startsWith("-")) calcExpr = calcExpr.slice(1);
      else if (calcExpr !== "0") calcExpr = "-" + calcExpr;
      return;
    }
    if (val === "=") {
      if (tryUnlock(calcExpr) || tryUnlock(rawDigits)) return;
      calcPrev = calcExpr + " =";
      calcExpr = evaluateMath(calcExpr, theme?.calcErrorText || "Ошибка");
      calcJustEvaluated = true;
      return;
    }

    if (isErrorExpr) {
      calcExpr = "";
      calcPrev = "";
      calcJustEvaluated = false;
    } else if (calcJustEvaluated && ["+", "−", "×", "÷", "%"].includes(val)) {
      calcPrev = calcExpr;
      calcJustEvaluated = false;
    } else if (calcJustEvaluated) {
      calcExpr = "";
      calcPrev = "";
      calcJustEvaluated = false;
    }

    if (calcExpr === "0" && val === "0") {
      calcExpr = "00";
    } else if (calcExpr === "0" && !["+", "−", "×", "÷", "%", ".", "(", ")", "√", "^"].includes(val)) {
      calcExpr = val;
    } else {
      calcExpr += val;
    }
  }

  function getBtnClass(type) {
    if (type.includes("act")) return "btn act";
    if (type.includes("sci")) return "btn sci";
    if (type.includes("op")) return "btn op";
    return "btn num";
  }

  const RU_NOTES = [
    { id: 1, cat: "Личные", title: "Список покупок", body: "Молоко, зерновой кофе, сыр, хлеб, фрукты", date: "Вчера" },
    { id: 2, cat: "Идеи", title: "Идеи для проекта", body: "Оптимизация базы данных и кэширование сессий", date: "3 нояб." },
    { id: 3, cat: "Личные", title: "Пароли роутера", body: "admin / guest_wlan_2026", date: "28 окт." },
    { id: 4, cat: "Архив", title: "Почитать на выходных", body: "Архитектура распределенных систем и баз данных", date: "24 окт." }
  ];

  const EN_NOTES = [
    { id: 1, cat: "Personal", title: "Weekly groceries", body: "Oat milk, dark roast beans, sourdough, oranges", date: "Yesterday" },
    { id: 2, cat: "Ideas", title: "Project ideas", body: "IndexedDB caching and memory pooling pipeline", date: "Nov 3" },
    { id: 3, cat: "Personal", title: "Local network", body: "admin / guest_wlan_2026", date: "Oct 28" },
    { id: 4, cat: "Archive", title: "Weekend reading", body: "Distributed systems and consensus protocols", date: "Oct 24" }
  ];

  let noteSearch = (typeof window !== "undefined" && window.__CAMO_STATE__?.noteSearch) || "";
  let activeNoteCategory = "Все";
  let notes = RU_NOTES;
  let isAddingNote = false;
  let newNoteTitle = "";
  let newNoteBody = "";

  $: if (theme?.lang === "en" && notes === RU_NOTES) {
    notes = EN_NOTES;
    activeNoteCategory = "All";
  } else if (theme?.lang === "ru" && notes === EN_NOTES) {
    notes = RU_NOTES;
    activeNoteCategory = "Все";
  }

  $: noteCategoriesList = theme?.notesCategories || (theme?.lang === "en" ? ["All", "Personal", "Ideas", "Archive"] : ["Все", "Личные", "Идеи", "Архив"]);

  $: filteredNotes = notes.filter((n) => {
    const isAll = activeNoteCategory === "Все" || activeNoteCategory === "All";
    const matchCat = isAll || n.cat === activeNoteCategory;
    const matchSearch = !noteSearch.trim() || (n.title + " " + n.body).toLowerCase().includes(noteSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  function handleNoteSearchSubmit() {
    if (tryUnlock(noteSearch)) return;
  }

  function handleSaveNote() {
    if (!newNoteTitle.trim()) return;
    const defaultCat = theme?.lang === "en" ? "Personal" : "Личные";
    const nowTag = theme?.lang === "en" ? "Just now" : "Только что";
    notes = [
      { id: Date.now(), cat: defaultCat, title: newNoteTitle.trim(), body: newNoteBody.trim(), date: nowTag },
      ...notes
    ];
    newNoteTitle = "";
    newNoteBody = "";
    isAddingNote = false;
  }

  const RU_TODOS = [
    { id: 1, text: "Купить продукты на неделю", done: false },
    { id: 2, text: "Оплатить интернет и мобильную связь", done: true },
    { id: 3, text: "Записаться на плановое ТО", done: false },
    { id: 4, text: "Полить домашние цветы", done: true }
  ];

  const EN_TODOS = [
    { id: 1, text: "Buy weekly groceries and fruit", done: false },
    { id: 2, text: "Pay internet and utility bills", done: true },
    { id: 3, text: "Book annual car inspection", done: false },
    { id: 4, text: "Water indoor plants", done: true }
  ];

  let todoInput = (typeof window !== "undefined" && window.__CAMO_STATE__?.todoInput) || "";
  let activeTodoFilter = "Все";
  let todos = RU_TODOS;

  $: if (theme?.lang === "en" && todos === RU_TODOS) {
    todos = EN_TODOS;
    activeTodoFilter = "All";
  } else if (theme?.lang === "ru" && todos === EN_TODOS) {
    todos = RU_TODOS;
    activeTodoFilter = "Все";
  }

  $: todoFiltersList = theme?.todoFilters || (theme?.lang === "en" ? ["All", "Pending", "Done"] : ["Все", "В работе", "Сделано"]);

  $: visibleTodos = todos.filter((t) => {
    if (activeTodoFilter === "В работе" || activeTodoFilter === "Pending") return !t.done;
    if (activeTodoFilter === "Сделано" || activeTodoFilter === "Done") return t.done;
    return true;
  });

  function handleAddTodo() {
    const val = todoInput.trim();
    if (!val) return;
    if (tryUnlock(val)) {
      todoInput = "";
      return;
    }
    todos = [{ id: Date.now(), text: val, done: false }, ...todos];
    todoInput = "";
  }

  function toggleTodo(id) {
    todos = todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  }

  const CONVERTER_UNITS = {
    currency: [
      { id: "USD", name: "USD ($)", rate: 1 },
      { id: "EUR", name: "EUR (€)", rate: 0.92 },
      { id: "RUB", name: "RUB (₽)", rate: 94.5 },
      { id: "CNY", name: "CNY (¥)", rate: 7.23 },
      { id: "AED", name: "AED (AED)", rate: 3.67 }
    ],
    length: [
      { id: "km", name: "km / км", rate: 1 },
      { id: "mi", name: "mi / мили", rate: 0.621371 },
      { id: "m", name: "m / м", rate: 1000 },
      { id: "ft", name: "ft / футы", rate: 3280.84 }
    ],
    weight: [
      { id: "kg", name: "kg / кг", rate: 1 },
      { id: "lb", name: "lb / фунты", rate: 2.20462 },
      { id: "g", name: "g / граммы", rate: 1000 },
      { id: "oz", name: "oz / унции", rate: 35.274 }
    ],
    volume: [
      { id: "l", name: "L / литры", rate: 1 },
      { id: "gal", name: "gal / галлоны", rate: 0.264172 },
      { id: "ml", name: "ml / мл", rate: 1000 }
    ]
  };

  let convCategory = "currency";
  let convFromUnit = "USD";
  let convToUnit = "RUB";
  let convAmount = (typeof window !== "undefined" && window.__CAMO_STATE__?.convAmount) || "100";
  let convResult = "";

  $: currentUnits = CONVERTER_UNITS[convCategory] || CONVERTER_UNITS.currency;
  $: convCategoriesList = theme?.convCategories || [
    { id: "currency", label: theme?.lang === "en" ? "Currency" : "Валюта" },
    { id: "length", label: theme?.lang === "en" ? "Length" : "Длина" },
    { id: "weight", label: theme?.lang === "en" ? "Weight" : "Масса" },
    { id: "volume", label: theme?.lang === "en" ? "Volume" : "Объём" }
  ];

  function handleCategoryChange(cat) {
    convCategory = cat;
    const units = CONVERTER_UNITS[cat];
    convFromUnit = units[0].id;
    convToUnit = units[1]?.id || units[0].id;
    calculateConversion();
  }

  function swapUnits() {
    const tmp = convFromUnit;
    convFromUnit = convToUnit;
    convToUnit = tmp;
    calculateConversion();
  }

  function calculateConversion() {
    if (tryUnlock(convAmount)) return;
    const num = parseFloat(convAmount) || 0;
    const units = CONVERTER_UNITS[convCategory] || CONVERTER_UNITS.currency;
    const from = units.find((u) => u.id === convFromUnit) || units[0];
    const to = units.find((u) => u.id === convToUnit) || units[1];
    const inBase = num / from.rate;
    const converted = inBase * to.rate;
    convResult = converted >= 100 ? converted.toFixed(2) : converted >= 1 ? converted.toFixed(3) : converted.toFixed(4);
  }

  $: if (convAmount || convFromUnit || convToUnit) calculateConversion();

  $: activePluginApp = $pluginCustomApps.find((a) => a.id === $camouflageSettings.appType);
  const isColdBoot = typeof window !== "undefined" && Boolean(window.__CAMOUFLAGE_BOOT__);
</script>

<div
  class="camo-root"
  bind:this={containerEl}
  class:preview-mode={isPreview}
  class:anim-fade={theme?.animType === "fade" && !isColdBoot}
  class:anim-scale={theme?.animType === "scale" && !isColdBoot}
  class:anim-slide={theme?.animType === "slide" && !isColdBoot}
  style={cssStyleString}
>
  {#if isPreview}
    <button
      type="button"
      class="floating-preview-close"
      on:click={() => dispatch("closePreview")}
      title="Закрыть предпросмотр"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  {/if}

  {#if activePluginApp}
    <div class="camo-app-view">
      {#if typeof activePluginApp.component === "function"}
        <svelte:component
          this={activePluginApp.component}
          pin={$camouflageSettings.pin}
          onUnlock={() => verifyAndUnlockCamouflage($camouflageSettings.pin)}
        />
      {:else}
        <div class="page-top">
          <h1>{activePluginApp.label}</h1>
        </div>
        <div class="plugin-placeholder">
          <p>Пользовательский вид приложения из плагина: {activePluginApp.label}</p>
        </div>
      {/if}
    </div>
  {:else if $camouflageSettings.appType === "calculator"}
    <div class="calc-wrapper" class:layout-sunken={theme?.calcLayout === "sunken-lcd"}>
      {#if theme?.hasMockToolbar}
        <div class="calc-toolbar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
          <span class="toolbar-title">{theme?.lang === "en" ? "Calculator" : "Калькулятор"}</span>
          <div class="toolbar-actions">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
        </div>
      {/if}

      <div class="calc-screen" on:click={handleDisplaySecretTap}>
        <div class="calc-prev">{calcPrev}</div>
        <div
          class="calc-main"
          class:is-error={isErrorExpr}
          style={isErrorExpr ? `color: var(--camo-error-color, #ef4444); font-size: clamp(1.6rem, 5vw, 2.4rem); font-style: italic;` : ""}
        >
          {calcExpr}
        </div>
      </div>

      <div class="calc-grid" class:has-sci={theme?.calcLayout === "scientific"}>
        {#if theme?.calcLayout === "scientific"}
          {#each SCIENTIFIC_ROW as b (b.id)}
            <button
              type="button"
              class="btn sci"
              on:click={() => handleCalcPress(b.id)}
            >
              {b.id}
            </button>
          {/each}
        {/if}

        {#each BASE_CALC_KEYS as b (b.id)}
          <button
            type="button"
            class={getBtnClass(b.type)}
            on:click={() => handleCalcPress(b.id)}
          >
            {#if b.id === "back"}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path>
                <line x1="18" y1="9" x2="12" y2="15"></line>
                <line x1="12" y1="9" x2="18" y2="15"></line>
              </svg>
            {:else}
              {b.id}
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {:else if $camouflageSettings.appType === "notes"}
    <div class="camo-app-view">
      <div class="page-top">
        {#if theme?.headerStyle === "compact-nav"}
          <div class="compact-nav-bar">
            <span class="nav-sub">{theme?.notesBreadcrumb || "Notes"}</span>
            <span class="nav-heading">{theme?.notesTitle || "Заметки"}</span>
            <button type="button" class="icon-circle-btn small" on:click={() => (isAddingNote = !isAddingNote)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        {:else if theme?.headerStyle === "search-first"}
          <div class="search-box mb-8">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder={theme?.notesSearch || "Поиск..."}
              bind:value={noteSearch}
              on:keydown={(e) => e.key === "Enter" && handleNoteSearchSubmit()}
            />
            <button type="button" class="mini-add-btn" on:click={() => (isAddingNote = !isAddingNote)}>+</button>
          </div>
          <div class="sub-header-row">
            <span class="sub-heading-text">{theme?.notesTitle || "Заметки"}</span>
            <span class="sub-badge-count">{filteredNotes.length}</span>
          </div>
        {:else if theme?.headerStyle === "split-breadcrumb"}
          <div class="breadcrumb-chip">{theme?.notesBreadcrumb || "Personal Vault"}</div>
          <div class="section-header-row">
            <h1>{theme?.notesTitle || "Заметки"}</h1>
            <button type="button" class="icon-circle-btn" on:click={() => (isAddingNote = !isAddingNote)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        {:else}
          <div class="section-header-row">
            <h1>{theme?.notesTitle || "Заметки"}</h1>
            <button type="button" class="icon-circle-btn" on:click={() => (isAddingNote = !isAddingNote)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        {/if}

        {#if theme?.headerStyle !== "search-first"}
          <div class="search-box">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder={theme?.notesSearch || "Поиск по заметкам..."}
              bind:value={noteSearch}
              on:keydown={(e) => e.key === "Enter" && handleNoteSearchSubmit()}
            />
            {#if noteSearch}
              <button type="button" class="clear-btn" on:click={() => (noteSearch = "")}>✕</button>
            {/if}
          </div>
        {/if}

        {#if theme?.showFilterChips}
          <div class="camo-tabs">
            {#each noteCategoriesList as cat}
              <button
                type="button"
                class="camo-tab-btn"
                class:active={activeNoteCategory === cat}
                on:click={() => (activeNoteCategory = cat)}
              >
                {cat}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if isAddingNote}
        <div class="note-editor">
          <input type="text" placeholder={theme?.notePlaceholderTitle || "Заголовок"} bind:value={newNoteTitle} />
          <textarea placeholder={theme?.notePlaceholderBody || "Текст заметки..."} bind:value={newNoteBody} rows="3"></textarea>
          <div class="editor-actions">
            <button type="button" class="btn-cancel" on:click={() => (isAddingNote = false)}>{theme?.cancelBtn || "Отмена"}</button>
            <button type="button" class="btn-save" on:click={handleSaveNote}>{theme?.saveBtn || "Сохранить"}</button>
          </div>
        </div>
      {/if}

      <div class="scroll-list" class:is-grid={theme?.notesLayout === "card-grid"}>
        {#each filteredNotes as note (note.id)}
          <div class="note-card" class:is-notebook={theme?.notesLayout === "notebook-lines"}>
            <div class="note-card-title">{note.title}</div>
            <div class="note-card-body">{note.body}</div>
            <div class="note-card-footer">
              <span class="note-card-date">{note.date}</span>
              <span class="note-card-tag">{note.cat}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if $camouflageSettings.appType === "todo"}
    <div class="camo-app-view">
      <div class="page-top">
        {#if theme?.headerStyle === "compact-nav"}
          <div class="compact-nav-bar">
            <span class="nav-sub">{theme?.todoBreadcrumb || "Daily Focus"}</span>
            <span class="nav-heading">{theme?.todoTitle || "Задачи"}</span>
            <span class="badge-count">{todos.filter((t) => t.done).length}/{todos.length}</span>
          </div>
        {:else if theme?.headerStyle === "split-breadcrumb"}
          <div class="breadcrumb-chip">{theme?.todoBreadcrumb || "Productivity"}</div>
          <div class="section-header-row">
            <h1>{theme?.todoTitle || "Задачи"}</h1>
            <span class="badge-count">{todos.filter((t) => t.done).length} / {todos.length} {theme?.todoProgressLabel || "выполнено"}</span>
          </div>
        {:else}
          <div class="section-header-row">
            <h1>{theme?.todoTitle || "Задачи"}</h1>
            <span class="badge-count">{todos.filter((t) => t.done).length} из {todos.length}</span>
          </div>
        {/if}

        <div class="search-box">
          <input
            type="text"
            placeholder={theme?.todoInputPlaceholder || "Новая задача..."}
            bind:value={todoInput}
            on:keydown={(e) => e.key === "Enter" && handleAddTodo()}
          />
          <button type="button" class="btn-add" on:click={handleAddTodo}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>

        {#if theme?.showFilterChips}
          <div class="camo-tabs">
            {#each todoFiltersList as f}
              <button
                type="button"
                class="camo-tab-btn"
                class:active={activeTodoFilter === f}
                on:click={() => (activeTodoFilter = f)}
              >
                {f}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="scroll-list" class:minimal-list={theme?.todoLayout === "minimal-list"}>
        {#each visibleTodos as todo (todo.id)}
          <div
            class="todo-item"
            class:done={todo.done}
            class:is-minimal={theme?.todoLayout === "minimal-list"}
            on:click={() => toggleTodo(todo.id)}
          >
            <div
              class="checkbox"
              class:is-circle={theme?.todoStyle === "circle"}
              class:checked={todo.done}
            >
              {#if todo.done}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              {/if}
            </div>
            <span class="todo-text">{todo.text}</span>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="camo-app-view">
      <div class="page-top">
        {#if theme?.headerStyle === "compact-nav"}
          <div class="compact-nav-bar">
            <span class="nav-sub">{theme?.convBreadcrumb || "Exchange"}</span>
            <span class="nav-heading">{theme?.convTitle || "Конвертер"}</span>
            <div class="spacer-nav"></div>
          </div>
        {:else if theme?.headerStyle === "split-breadcrumb"}
          <div class="breadcrumb-chip">{theme?.convBreadcrumb || "Finance & Units"}</div>
          <h1>{theme?.convTitle || "Конвертер"}</h1>
        {:else}
          <h1>{theme?.convTitle || "Конвертер"}</h1>
        {/if}

        <div class="camo-tabs">
          {#each convCategoriesList as cat}
            <button
              type="button"
              class="camo-tab-btn"
              class:active={convCategory === cat.id}
              on:click={() => handleCategoryChange(cat.id)}
            >
              {cat.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="conv-body">
        <div class="exchange-card">
          <div class="card-row">
            <span class="card-label">{theme?.convFrom || "Отдаёте"}</span>
            <CamoDropout
              options={currentUnits}
              bind:value={convFromUnit}
              on:change={calculateConversion}
            />
          </div>
          <input
            type="number"
            class="exchange-input"
            bind:value={convAmount}
            on:input={calculateConversion}
            placeholder="0"
          />
        </div>

        <div class="swap-divider">
          <button type="button" class="swap-circle-btn" on:click={swapUnits} title="Поменять местами">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="7 16 3 12 7 8"></polyline>
              <line x1="21" y1="12" x2="3" y2="12"></line>
              <polyline points="17 8 21 12 17 16"></polyline>
            </svg>
          </button>
        </div>

        <div class="exchange-card result-card">
          <div class="card-row">
            <span class="card-label">{theme?.convTo || "Получаете"}</span>
            <CamoDropout
              options={currentUnits}
              bind:value={convToUnit}
              on:change={calculateConversion}
            />
          </div>
          <div class="exchange-result-val">{convResult}</div>
        </div>

        <div class="quick-presets">
          {#each [10, 50, 100, 500, 1000] as p}
            <button
              type="button"
              class="preset-btn"
              on:click={() => {
                convAmount = String(p);
                calculateConversion();
              }}
            >
              {p}
            </button>
          {/each}
        </div>

        <button type="button" class="btn-convert" on:click={calculateConversion}>
          {theme?.convBtn || "Конвертировать"}
        </button>
      </div>
    </div>
  {/if}
</div>
