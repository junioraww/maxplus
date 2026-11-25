<script>
  import { createEventDispatcher } from "svelte";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { showAlert } from "$lib/utils/alert";
  import Switch from "$components/common/Switch.svelte";

  const dispatch = createEventDispatcher();

  export let onCreate = null;
  export let close = null;

  const POLL_FLAG_ANONYMOUS = 1;
  const POLL_FLAG_MULTIPLE = 2;
  const POLL_FLAG_REVOTE = 4;
  const POLL_FLAG_CLOSED = 8;
  const POLL_FLAG_SUBSCRIBERS_ONLY = 32;

  let title = "";
  let options = [""];
  let description = "";
  let coverPath = null;
  let coverPreviewUrl = null;

  let showParticipants = true;
  let multipleAnswers = false;
  let canRevote = true;

  let fileInputEl = null;

  const MAX_OPTIONS = 12;

  function handleClose() {
    if (typeof close === "function") {
      close();
    } else {
      dispatch("close");
    }
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) {
      return showAlert(`Максимум ${MAX_OPTIONS} вариантов ответа`);
    }
    options = [...options, ""];
  }

  function removeOption(idx) {
    if (options.length <= 1) {
      options[idx] = "";
      options = options;
      return;
    }
    options = options.filter((_, i) => i !== idx);
  }

  function getPluralAnswers(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return "ответов";
    if (mod10 === 1) return "ответ";
    if (mod10 >= 2 && mod10 <= 4) return "ответа";
    return "ответов";
  }

  async function handlePickCover() {
    try {
      const response = await invoke("pick", { type: "PHOTO" }).catch(() => null);
      if (response && response !== "CANCEL") {
        const { uri } = response;
        const rawPath = decodeURIComponent(uri);
        coverPath = rawPath;
        coverPreviewUrl = typeof convertFileSrc === "function" ? convertFileSrc(rawPath) : rawPath;
        return;
      }
    } catch {}

    if (fileInputEl) {
      fileInputEl.click();
    }
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      coverPath = file.name;
      coverPreviewUrl = URL.createObjectURL(file);
    }
  }

  function removeCover() {
    coverPath = null;
    coverPreviewUrl = null;
    if (fileInputEl) fileInputEl.value = "";
  }

  function submit() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      return showAlert("Введите вопрос");
    }

    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (cleanOptions.length < 2) {
      return showAlert("Заполните хотя бы 2 варианта ответа");
    }

    let calculatedSettings = 0;
    if (!showParticipants) {
      calculatedSettings |= POLL_FLAG_ANONYMOUS;
    }
    if (multipleAnswers) {
      calculatedSettings |= POLL_FLAG_MULTIPLE;
    }
    if (canRevote) {
      calculatedSettings |= POLL_FLAG_REVOTE;
    }

    const detail = {
      title: cleanTitle,
      options: cleanOptions,
      settings: calculatedSettings,
      description: description.trim() || undefined,
      cover: coverPath || undefined,
    };

    dispatch("create", detail);
    if (typeof onCreate === "function") {
      onCreate(detail);
    }
    handleClose();
  }

  $: remainingOptions = Math.max(0, MAX_OPTIONS - options.length);
  $: canSubmit = title.trim().length > 0 && options.filter((o) => o.trim().length > 0).length >= 2;
</script>

<div class="poll-screen-root">
  <header class="poll-screen-header">
    <button
      type="button"
      class="header-close-btn"
      on:click={handleClose}
      aria-label="Закрыть"
    >
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 20px; height: 20px;"></span>
    </button>
    <h1 class="header-title">Новый опрос</h1>
    <div class="header-spacer"></div>
  </header>

  <div class="poll-screen-body">
    <!-- SECTION 1: QUESTION INPUT -->
    <div class="card-box question-card">
      <input
        type="text"
        class="question-input"
        placeholder="Введите вопрос"
        maxlength="200"
        bind:value={title}
      />
      <span class="counter-badge">{200 - title.length}</span>
    </div>

    <!-- SECTION 2: OPTIONS -->
    <div class="section-container">
      <div class="section-title">Варианты ответов</div>
      <div class="card-box options-card">
        {#each options as opt, i}
          <div class="option-row">
            <span class="mask-icon reorder-icon" style="-webkit-mask-image: url('/icons/reorder.svg'); mask-image: url('/icons/reorder.svg'); width: 18px; height: 18px;"></span>
            <input
              type="text"
              class="option-input"
              placeholder="Введите ответ"
              maxlength="100"
              bind:value={options[i]}
            />
            <button
              type="button"
              class="remove-opt-btn"
              class:is-hidden={!(opt.length > 0 || options.length > 1)}
              tabindex={opt.length > 0 || options.length > 1 ? 0 : -1}
              on:click={() => removeOption(i)}
              aria-label="Удалить вариант"
            >
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 14px; height: 14px;"></span>
            </button>
          </div>
        {/each}

        {#if options.length < MAX_OPTIONS}
          <button type="button" class="add-option-btn" on:click={addOption}>
            <span class="mask-icon add-plus-icon" style="-webkit-mask-image: url('/icons/plus.svg'); mask-image: url('/icons/plus.svg'); width: 16px; height: 16px;"></span>
            <span>Добавить ответ</span>
          </button>
        {/if}
      </div>

      {#if remainingOptions > 0}
        <div class="section-subtitle">
          Можно добавить ещё {remainingOptions} {getPluralAnswers(remainingOptions)}
        </div>
      {/if}
    </div>

    <!-- SECTION 3: FORMATTING / MEDIA -->
    <div class="section-container">
      <div class="section-title">Оформление</div>
      <div class="card-box decoration-card">
        <div class="cover-row">
          {#if coverPreviewUrl}
            <div class="cover-preview-wrap">
              <img src={coverPreviewUrl} alt="Cover" class="cover-thumb" on:error={() => { coverPreviewUrl = null; showAlert("Не удалось загрузить изображение"); }} />
              <button type="button" class="remove-cover-btn" on:click={removeCover} title="Удалить обложку">
                ✕
              </button>
            </div>
            <span class="cover-name-label">{coverPath?.split('/')?.pop() || 'Обложка прикреплена'}</span>
          {:else}
            <button type="button" class="add-cover-btn" on:click={handlePickCover}>
              <span class="mask-icon cover-icon" style="-webkit-mask-image: url('/icons/image-plus.svg'); mask-image: url('/icons/image-plus.svg'); width: 22px; height: 22px;"></span>
              <span>Добавить обложку</span>
            </button>
          {/if}
        </div>

        <div class="divider-line"></div>

        <div class="description-row">
          <input
            type="text"
            class="description-input"
            placeholder="Описание опроса"
            maxlength="400"
            bind:value={description}
          />
        </div>
      </div>
    </div>

    <!-- SECTION 4: SETTINGS -->
    <div class="section-container">
      <div class="section-title">Настройки опроса</div>
      <div class="card-box settings-card">
        <div class="setting-item-row" on:click={() => (showParticipants = !showParticipants)}>
          <span class="setting-label">Показывать участников</span>
          <Switch checked={showParticipants} ariaLabel="Показывать участников" />
        </div>

        <div class="divider-line"></div>

        <div class="setting-item-row" on:click={() => (multipleAnswers = !multipleAnswers)}>
          <span class="setting-label">Несколько вариантов ответа</span>
          <Switch checked={multipleAnswers} ariaLabel="Несколько вариантов ответа" />
        </div>

        <div class="divider-line"></div>

        <div class="setting-item-row" on:click={() => (canRevote = !canRevote)}>
          <span class="setting-label">Можно переголосовать</span>
          <Switch checked={canRevote} ariaLabel="Можно переголосовать" />
        </div>
      </div>
    </div>

    <!-- SUBMIT BUTTON -->
    <div class="submit-wrap">
      <button
        type="button"
        class="create-btn"
        disabled={!canSubmit}
        on:click={submit}
      >
        Создать
      </button>
    </div>
  </div>

  <input
    bind:this={fileInputEl}
    type="file"
    accept="image/*"
    style="display: none;"
    on:change={handleFileInputChange}
  />
</div>

<style>
  .poll-screen-root {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #101114;
    color: #ffffff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    box-sizing: border-box;
    z-index: 1;
  }

  .poll-screen-header {
    height: 56px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .header-close-btn {
    background: transparent;
    border: none;
    color: #ffffff;
    cursor: pointer;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.15s ease;
  }

  .header-close-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .header-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: #ffffff;
    text-align: center;
    flex: 1;
  }

  .header-spacer {
    width: 40px;
  }

  .poll-screen-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: calc(24px + var(--safe-bottom, 0px));
    -webkit-overflow-scrolling: touch;
  }

  .card-box {
    background: #1c1e24;
    border-radius: 16px;
    margin: 0 16px;
    overflow: hidden;
  }

  /* SECTION 1 */
  .question-card {
    margin-top: 12px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .question-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 16px;
    font-family: inherit;
    caret-color: #248bfe;
  }

  .question-input::placeholder {
    color: #606470;
  }

  .counter-badge {
    font-size: 14px;
    color: #8a8d9b;
    flex-shrink: 0;
  }

  /* SECTIONS */
  .section-container {
    margin-top: 20px;
  }

  .section-title {
    font-size: 13px;
    font-weight: 500;
    color: #8a8d9b;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 20px 8px 20px;
  }

  .section-subtitle {
    font-size: 13px;
    color: #8a8d9b;
    padding: 8px 20px 0 20px;
  }

  /* OPTIONS */
  .options-card {
    display: flex;
    flex-direction: column;
  }

  .option-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    height: 48px;
    min-height: 48px;
    max-height: 48px;
    box-sizing: border-box;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .reorder-icon {
    background-color: #8a8d9b;
    flex-shrink: 0;
  }

  .option-input {
    flex: 1;
    height: 24px;
    line-height: 24px;
    padding: 0;
    margin: 0;
    background: transparent;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 16px;
    font-family: inherit;
    caret-color: #248bfe;
    box-sizing: border-box;
  }

  .option-input::placeholder {
    color: #606470;
  }

  .remove-opt-btn {
    background: transparent;
    border: none;
    color: #8a8d9b;
    cursor: pointer;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    border-radius: 50%;
    box-sizing: border-box;
    transition: opacity 0.15s ease, background 0.15s ease;
  }

  .remove-opt-btn.is-hidden {
    visibility: hidden;
    pointer-events: none;
    opacity: 0;
  }

  .remove-opt-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  .add-option-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: transparent;
    border: none;
    color: #248bfe;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
  }

  .add-option-btn:hover {
    background: rgba(36, 139, 254, 0.06);
  }

  .add-plus-icon {
    background-color: #248bfe;
    flex-shrink: 0;
  }

  /* DECORATION */
  .cover-row {
    padding: 14px 16px;
    display: flex;
    align-items: center;
  }

  .add-cover-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    background: transparent;
    border: none;
    color: #248bfe;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    padding: 0;
  }

  .cover-icon {
    background-color: #248bfe;
    flex-shrink: 0;
  }

  .cover-preview-wrap {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    overflow: hidden;
    margin-right: 12px;
    flex-shrink: 0;
  }

  .cover-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .remove-cover-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 16px;
    height: 16px;
    background: rgba(0, 0, 0, 0.7);
    color: #ffffff;
    border: none;
    border-radius: 50%;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }

  .cover-name-label {
    font-size: 15px;
    color: #ffffff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .description-row {
    padding: 14px 16px;
  }

  .description-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 16px;
    font-family: inherit;
    box-sizing: border-box;
    caret-color: #248bfe;
  }

  .description-input::placeholder {
    color: #606470;
  }

  .divider-line {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 0;
  }

  /* SETTINGS TOGGLES */
  .setting-item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
  }

  .setting-label {
    font-size: 16px;
    color: #ffffff;
  }

  /* SUBMIT BUTTON */
  .submit-wrap {
    margin: 24px 16px calc(16px + var(--safe-bottom, 0px)) 16px;
  }

  .create-btn {
    width: 100%;
    height: 50px;
    background: #248bfe;
    color: #ffffff;
    border: none;
    border-radius: 20px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease, opacity 0.15s ease, transform 0.1s ease;
  }

  .create-btn:hover:not(:disabled) {
    background: #1b74d9;
  }

  .create-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .create-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
