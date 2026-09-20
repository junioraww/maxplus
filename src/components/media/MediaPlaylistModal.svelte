<script>
  import {
    mediaPlaylist,
    showPlaylistModal,
    playPlaylistItem,
    activeMedia,
  } from '$lib/stores/mediaPlayback';

  $: playlist = $mediaPlaylist;
  $: items = playlist?.items || [];
  $: currentIndex = playlist?.currentIndex ?? -1;
  $: isPlaying = $activeMedia?.isPlaying ?? false;

  function closeModal() {
    showPlaylistModal.set(false);
  }

  function handleSelectTrack(index) {
    playPlaylistItem(index);
    closeModal();
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.round(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
</script>

{#if $showPlaylistModal}
  <div class="modal-backdrop" on:click|self={closeModal}>
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-title">Очередь воспроизведения</span>
          <span class="modal-count">{items.length} медиа</span>
        </div>
        <button class="modal-close-btn" on:click={closeModal} title="Закрыть">✕</button>
      </div>

      <div class="modal-body">
        {#if items.length === 0}
          <div class="empty-state">Нет голосовых и кружочков в очереди!</div>
        {:else}
          <div class="playlist-items-list">
            {#each items as item, index (item.id || item.messageId || index)}
              <div
                class="playlist-row"
                class:active={index === currentIndex}
                on:click={() => handleSelectTrack(index)}
              >
                <div class="row-left">
                  <div class="track-icon" class:active={index === currentIndex}>
                    {#if index === currentIndex && isPlaying}
                      <span class="sound-wave-anim">
                        <i></i><i></i><i></i>
                      </span>
                    {:else if item.type === 'video_note'}
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                      </svg>
                    {:else}
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                      </svg>
                    {/if}
                  </div>
                  <div class="track-info">
                    <div class="track-sender">
                      {item.senderName || 'Чат'}
                    </div>
                    <div class="track-type">
                      {item.type === 'video_note' ? 'Видеосообщение' : 'Голосовое сообщение'}
                    </div>
                  </div>
                </div>

                <div class="row-right">
                  <span class="track-dur">{formatTime(item.duration)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 16px;
  }
  .modal-dialog {
    width: 100%;
    max-width: 420px;
    max-height: 80vh;
    background: #1e2024;
    border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .modal-title-wrap {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .modal-title {
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
  }
  .modal-count {
    font-size: 12px;
    color: #8e9aa8;
  }
  .modal-close-btn {
    background: transparent;
    border: none;
    font-size: 16px;
    color: #8e9aa8;
    cursor: pointer;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .modal-close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: #8e9aa8;
    font-size: 14px;
  }
  .playlist-items-list {
    display: flex;
    flex-direction: column;
  }
  .playlist-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px;
    cursor: pointer;
    transition: background 0.12s;
    user-select: none;
  }
  .playlist-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .playlist-row.active {
    background: rgba(43, 130, 217, 0.18);
  }
  .row-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .track-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: #8e9aa8;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .track-icon.active {
    background: #2b82d9;
    color: #fff;
  }
  .track-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .track-sender {
    font-size: 14px;
    font-weight: 500;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track-type {
    font-size: 12px;
    color: #8e9aa8;
  }
  .row-right {
    margin-left: 12px;
    flex-shrink: 0;
  }
  .track-dur {
    font-size: 12px;
    color: #8e9aa8;
  }
  .sound-wave-anim {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
  }
  .sound-wave-anim i {
    width: 2px;
    background: #fff;
    border-radius: 1px;
    animation: wave 0.8s ease-in-out infinite alternate;
  }
  .sound-wave-anim i:nth-child(1) { height: 6px; animation-delay: 0.1s; }
  .sound-wave-anim i:nth-child(2) { height: 14px; animation-delay: 0.3s; }
  .sound-wave-anim i:nth-child(3) { height: 9px; animation-delay: 0.2s; }
  @keyframes wave {
    0% { height: 4px; }
    100% { height: 14px; }
  }
</style>
