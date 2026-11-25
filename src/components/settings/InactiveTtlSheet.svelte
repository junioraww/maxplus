<script>
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import { privacyConfig, updatePrivacySetting } from "$lib/stores/privacySettings";

  export let close = null;
  export let onClose = null;
  export let setBackHandler = null;

  let saving = false;

  const OPTIONS = [
    { value: "1M", label: "1 месяц" },
    { value: "3M", label: "3 месяца" },
    { value: "6M", label: "6 месяцев" },
  ];

  function dismiss() {
    if (onClose) onClose();
    else if (close) close();
  }

  async function selectOption(value) {
    if (saving) return;
    if ($privacyConfig?.inactiveTtl === value) {
      dismiss();
      return;
    }
    saving = true;
    try {
      await updatePrivacySetting("INACTIVE_TTL", value);
      dismiss();
    } catch {
    } finally {
      saving = false;
    }
  }
</script>

<BottomSheet title="" showClose={false} showHandle={true} {close} {setBackHandler} on:close={dismiss}>
  <div class="ttl-sheet">
    <h2 class="ttl-sheet-title">Удаление профиля при неактивности</h2>

    <div class="ttl-options">
      {#each OPTIONS as opt (opt.value)}
        <button
          type="button"
          class="ttl-option-btn"
          class:active={$privacyConfig?.inactiveTtl === opt.value}
          disabled={saving}
          on:click={() => selectOption(opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>
</BottomSheet>

<style>
  .ttl-sheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 16px 12px;
    text-align: center;
  }

  .ttl-sheet-title {
    margin: 4px 0 14px;
    max-width: 280px;
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 19px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--settings-text-primary, #ffffff);
  }

  .ttl-options {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ttl-option-btn {
    width: 100%;
    height: 52px;
    border: none;
    border-radius: 14px;
    background: transparent;
    color: var(--settings-text-primary, #ffffff);
    font-family: var(--settings-font-body, var(--font-family-base));
    font-size: 16px;
    font-weight: 400;
    cursor: pointer;
    transition: background-color 0.14s, color 0.14s;
  }

  .ttl-option-btn:hover:not(:disabled) {
    background: var(--settings-card-hover, rgba(255, 255, 255, 0.06));
  }

  .ttl-option-btn:active:not(:disabled) {
    background: var(--settings-card-active, rgba(255, 255, 255, 0.1));
  }

  .ttl-option-btn.active {
    color: var(--settings-accent, #007aff);
    font-weight: 500;
  }

  .ttl-option-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
