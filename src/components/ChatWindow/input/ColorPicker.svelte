<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from "$lib/formatting/colorStego";
  import {
    colorPresets,
    lastUsedColor,
    initColorSettings,
    saveColorPresets,
    saveLastUsedColor,
  } from "$lib/stores/colorSettings";

  export let initialColor = "#FF5252";

  const dispatch = createEventDispatcher();

  let presets = [...$colorPresets];
  let selectedPresetIndex = 0;

  let h = 0;
  let s = 1;
  let v = 1;

  let hexInput = initialColor || "#FF5252";
  let rgb = [255, 82, 82];

  let satBoxEl;
  let hueSliderEl;
  let rafId = null;

  let unregisterBack = null;
  let isBackdropPointerDown = false;
  let activeDragMode = null;
  let activeCaptureEl = null;
  let activePointerId = null;

  $: currentRgb = hsvToRgb(h, s, v);
  $: currentHex = rgbToHex(currentRgb[0], currentRgb[1], currentRgb[2]);
  $: hueHslBg = `hsl(${Math.round(h * 360)}, 100%, 50%)`;

  function initFromHex(hex) {
    const parsedRgb = hexToRgb(hex);
    if (!parsedRgb) return;
    const [nh, ns, nv] = rgbToHsv(...parsedRgb);
    h = nh;
    s = ns;
    v = nv;
    syncInputs(...parsedRgb, hex);
  }

  function syncInputs(r, g, b, hex) {
    rgb = [r, g, b];
    hexInput = hex.toUpperCase();
  }

  function persistState() {
    saveColorPresets(presets);
    saveLastUsedColor(currentHex);
  }

  onMount(async () => {
    await initColorSettings();
    presets = [...$colorPresets];
    const matchIdx = presets.findIndex(
      (p) => p.toUpperCase() === (initialColor || "").toUpperCase()
    );
    if (matchIdx !== -1) {
      selectedPresetIndex = matchIdx;
    }
    initFromHex(initialColor || presets[selectedPresetIndex] || "#FF5252");
    unregisterBack = registerBackHandler(() => {
      submitClose();
      return true;
    });
  });

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("pointermove", handleGlobalPointerMove);
    window.removeEventListener("pointerup", handleGlobalPointerUp);
  });

  function updatePointer(mode, e) {
    const el = mode === "sat" ? satBoxEl : hueSliderEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const cy = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    const x = Math.max(0, Math.min(rect.width, cx - rect.left));

    if (mode === "sat") {
      const y = Math.max(0, Math.min(rect.height, cy - rect.top));
      s = x / rect.width;
      v = 1 - (y / rect.height);
    } else {
      h = Math.max(0, Math.min(1, x / rect.width));
    }

    const [r, g, b] = hsvToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);
    syncInputs(r, g, b, hex);

    if (selectedPresetIndex >= 0 && selectedPresetIndex < presets.length) {
      presets[selectedPresetIndex] = hex;
      presets = [...presets];
    }
  }

  function handlePointerDown(mode, e) {
    e.preventDefault();
    e.stopPropagation();
    activeDragMode = mode;
    activeCaptureEl = e.currentTarget;
    activePointerId = e.pointerId;
    if (activeCaptureEl && activePointerId != null && activeCaptureEl.setPointerCapture) {
      try {
        activeCaptureEl.setPointerCapture(activePointerId);
      } catch {}
    }
    updatePointer(mode, e);
    window.addEventListener("pointermove", handleGlobalPointerMove);
    window.addEventListener("pointerup", handleGlobalPointerUp);
  }

  function handleGlobalPointerMove(e) {
    if (!activeDragMode) return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => updatePointer(activeDragMode, e));
  }

  function handleGlobalPointerUp() {
    if (activeCaptureEl && activePointerId != null && activeCaptureEl.releasePointerCapture) {
      try {
        activeCaptureEl.releasePointerCapture(activePointerId);
      } catch {}
    }
    activeCaptureEl = null;
    activePointerId = null;
    if (activeDragMode) {
      activeDragMode = null;
      persistState();
    }
    isBackdropPointerDown = false;
    window.removeEventListener("pointermove", handleGlobalPointerMove);
    window.removeEventListener("pointerup", handleGlobalPointerUp);
  }

  function handleHexChange(e) {
    let val = e.target.value.trim();
    if (!val.startsWith("#")) val = "#" + val;
    hexInput = val;
    const parsedRgb = hexToRgb(val);
    if (parsedRgb) {
      const [nh, ns, nv] = rgbToHsv(...parsedRgb);
      h = nh;
      s = ns;
      v = nv;
      rgb = parsedRgb;
      if (selectedPresetIndex >= 0 && selectedPresetIndex < presets.length) {
        presets[selectedPresetIndex] = currentHex;
        presets = [...presets];
        persistState();
      }
    }
  }

  function handleRgbChange() {
    const [r, g, b] = rgb.map((n) => Math.max(0, Math.min(255, Number(n) || 0)));
    const [nh, ns, nv] = rgbToHsv(r, g, b);
    h = nh;
    s = ns;
    v = nv;
    hexInput = rgbToHex(r, g, b);
    if (selectedPresetIndex >= 0 && selectedPresetIndex < presets.length) {
      presets[selectedPresetIndex] = currentHex;
      presets = [...presets];
      persistState();
    }
  }

  function selectPreset(hex, index) {
    selectedPresetIndex = index;
    initFromHex(hex);
    persistState();
  }

  function submitApply() {
    persistState();
    dispatch("apply", { color: currentHex });
  }

  function submitClear() {
    dispatch("clear");
  }

  function submitClose() {
    persistState();
    dispatch("close");
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      submitClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitApply();
    }
  }

  function handleBackdropPointerDown(e) {
    if (e.target === e.currentTarget) {
      isBackdropPointerDown = true;
    }
  }

  function handleBackdropPointerUp(e) {
    if (isBackdropPointerDown && e.target === e.currentTarget && !activeDragMode) {
      submitClose();
    }
    isBackdropPointerDown = false;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  class="color-picker-backdrop"
  on:pointerdown={handleBackdropPointerDown}
  on:pointerup={handleBackdropPointerUp}
  on:contextmenu|preventDefault|stopPropagation
  transition:fade={{ duration: 140 }}
>
  <div
    class="color-picker-card"
    transition:scale={{ duration: 160, start: 0.94 }}
    on:pointerdown|stopPropagation
    on:mousedown|stopPropagation
    on:click|stopPropagation
  >
    <div class="card-header">
      <div class="header-left">
        <span class="color-preview-badge" style="background-color: {currentHex};"></span>
        <span class="header-title">Цвет текста</span>
      </div>
      <button type="button" class="close-btn" on:click={submitClose} aria-label="Закрыть">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div
      class="sat-val-box"
      bind:this={satBoxEl}
      style="background-color: {hueHslBg};"
      on:pointerdown={(e) => handlePointerDown("sat", e)}
    >
      <div
        class="sat-val-cursor"
        style="left: {s * 100}%; top: {(1 - v) * 100}%; background-color: {currentHex};"
      ></div>
    </div>

    <div class="hue-row">
      <div
        class="hue-slider"
        bind:this={hueSliderEl}
        on:pointerdown={(e) => handlePointerDown("hue", e)}
      >
        <div
          class="hue-cursor"
          style="left: {h * 100}%;"
        ></div>
      </div>
    </div>

    <div class="inputs-row">
      <div class="input-field hex-field">
        <span class="field-label">HEX</span>
        <input
          type="text"
          class="text-input"
          bind:value={hexInput}
          on:input={handleHexChange}
          maxlength="7"
          spellcheck="false"
        />
      </div>

      {#each ['R', 'G', 'B'] as label, i}
        <div class="input-field rgb-field">
          <span class="field-label">{label}</span>
          <input
            type="number"
            class="text-input num-input"
            min="0"
            max="255"
            bind:value={rgb[i]}
            on:input={handleRgbChange}
          />
        </div>
      {/each}
    </div>

    <div class="presets-row">
      {#each presets as preset, index}
        <button
          type="button"
          class="preset-chip"
          class:is-active={selectedPresetIndex === index}
          style="background-color: {preset};"
          on:click={() => selectPreset(preset, index)}
          aria-label={preset}
        ></button>
      {/each}
    </div>

    <div class="actions-row">
      <button type="button" class="action-btn clear-btn" on:click={submitClear}>
        Сбросить
      </button>
      <div class="actions-right">
        <button type="button" class="action-btn cancel-btn" on:click={submitClose}>
          Отмена
        </button>
        <button type="button" class="action-btn apply-btn" on:click={submitApply}>
          Применить
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .color-picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2500;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    touch-action: none;
  }

  .color-picker-card {
    background: #1e2025;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
    width: 280px;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    color: #ffffff;
    user-select: none;
    touch-action: none;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-preview-badge {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.6);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .header-title {
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    transition: background 0.14s ease, color 0.14s ease;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .sat-val-box {
    position: relative;
    width: 100%;
    height: 135px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
    background: linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, transparent);
  }

  .sat-val-cursor {
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2.5px solid #ffffff;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.8), inset 0 0 2px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .hue-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .hue-slider {
    position: relative;
    flex: 1;
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      #ff0000 0%,
      #ffff00 17%,
      #00ff00 33%,
      #00ffff 50%,
      #0000ff 67%,
      #ff00ff 83%,
      #ff0000 100%
    );
    cursor: pointer;
    touch-action: none;
  }

  .hue-cursor {
    position: absolute;
    top: 50%;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid rgba(0, 0, 0, 0.25);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .inputs-row {
    display: flex;
    gap: 6px;
  }

  .input-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .hex-field {
    flex: 1.4;
  }

  .rgb-field {
    flex: 1;
  }

  .field-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .text-input {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    padding: 6px 4px;
    text-align: center;
    outline: none;
    box-sizing: border-box;
    width: 100%;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .text-input:focus {
    border-color: #7b4cd6;
    box-shadow: 0 0 0 2px rgba(123, 76, 214, 0.25);
  }

  .num-input::-webkit-outer-spin-button,
  .num-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .presets-row {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
    justify-items: center;
  }

  .preset-chip {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1.5px solid rgba(0, 0, 0, 0.2);
    cursor: pointer;
    padding: 0;
    transition: transform 0.14s ease, box-shadow 0.14s ease;
  }

  .preset-chip:hover {
    transform: scale(1.15);
  }

  .preset-chip.is-active {
    box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px rgba(123, 76, 214, 0.4);
    transform: scale(1.1);
  }

  .actions-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .actions-right {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    padding: 7px 12px;
    cursor: pointer;
    transition: background 0.14s ease, opacity 0.14s ease, color 0.14s ease;
  }

  .clear-btn {
    background: transparent;
    color: #ff5252;
    padding-left: 2px;
  }

  .clear-btn:hover {
    background: transparent;
    color: #ff7373;
  }

  .cancel-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #e1e4ea;
  }

  .cancel-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .apply-btn {
    background: #7b4cd6;
    color: #ffffff;
    font-weight: 600;
  }

  .apply-btn:hover {
    background: #8e62e3;
  }

  @media (max-width: 480px) {
    .color-picker-backdrop {
      padding: 0;
      align-items: flex-end;
    }

    .color-picker-card {
      width: 100vw;
      max-width: 100vw;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
      padding: 16px 16px calc(16px + var(--safe-bottom, 0px));
      box-sizing: border-box;
      gap: 14px;
    }

    .sat-val-box {
      height: 150px;
      border-radius: 8px;
    }

    .preset-chip {
      width: 26px;
      height: 26px;
    }
  }
</style>
