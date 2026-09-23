<script>
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();

  function selectFile(type) {
    dispatch("select", { type });
  }
</script>

<div class="attaches-dropout">
  <button type="button" class="dropout-item" on:click={() => selectFile("PHOTO")}>
    <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
    <span>Изображение</span>
  </button>
  <button type="button" class="dropout-item" on:click={() => selectFile("VIDEO")}>
    <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
    <span>Видео</span>
  </button>
  <button type="button" class="dropout-item" on:click={() => selectFile("VOICE_NOTE")}>
    <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
    <span>Голосовое из файла</span>
  </button>
  <button type="button" class="dropout-item" on:click={() => selectFile("VIDEO_NOTE")}>
    <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/>
    </svg>
    <span>Видеосообщение из файла</span>
  </button>
  <button type="button" class="dropout-item" on:click={() => selectFile("FILE")}>
    <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
    <span>Файл</span>
  </button>
</div>

<style>
  .attaches-dropout {
    position: absolute;
    bottom: 54px;
    left: 0;
    background: #1e2025;
    border: none;
    border-radius: 14px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 40;
    min-width: 165px;
    animation: dropout-fade 0.12s ease-out;
  }

  @keyframes dropout-fade {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .dropout-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: transparent;
    border: none;
    color: #e1e4ea;
    padding: 9px 12px;
    border-radius: 10px;
    text-align: left;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background-color 0.12s ease;
  }

  .dropout-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .dropout-svg {
    color: #e1e4ea;
    flex-shrink: 0;
  }
</style>
