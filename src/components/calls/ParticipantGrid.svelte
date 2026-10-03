<script>
  import { activeCall } from '$lib/stores/calls.js';

  $: participants = $activeCall.participants;

  $: gridClass = (() => {
    const n = participants.length;
    if (n === 0) return 'grid--empty';
    if (n === 1) return 'grid--1';
    if (n === 2) return 'grid--2';
    if (n <= 4) return 'grid--4';
    if (n <= 6) return 'grid--6';
    return 'grid--many';
  })();

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function avatarColor(id) {
    const palette = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#ef4444','#6366f1'];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }
</script>

<div class="participant-grid {gridClass}">
  {#if participants.length === 0}
    <div class="waiting-state">
      <div class="waiting-icon">
        <img src="/icons/users.svg" alt="" width="36" height="36" />
      </div>
      <p class="waiting-label">Ожидание участников...</p>
    </div>
  {:else}
    {#each participants as p (p.id)}
      <div class="participant-tile">
        <div class="tile-inner">
          <div
            class="participant-avatar"
            style="background-color: {avatarColor(p.id)}; {p.avatar ? `background-image: url('${p.avatar}'); background-color: transparent;` : ''}"
          >
            {#if !p.avatar}
              <span class="avatar-initials">{initials(p.name)}</span>
            {/if}
          </div>

          <p class="participant-name">{p.name || 'Участник'}</p>

          {#if p.muted}
            <div class="mute-badge" title="Микрофон выключен">
              <img src="/icons/mic-off.svg" alt="" width="12" height="12" />
            </div>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .participant-grid {
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 6px;
    padding: 6px;
    box-sizing: border-box;
    align-content: center;
    justify-content: center;
  }

  .grid--empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .grid--1 {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }

  .grid--2 {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
  }

  .grid--4 {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }

  .grid--6 {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: repeat(3, 1fr);
  }

  .grid--many {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(auto-fill, minmax(0, 1fr));
  }

  .waiting-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: rgba(255, 255, 255, 0.4);
  }

  .waiting-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.07);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .waiting-label {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
  }

  .participant-tile {
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.07);
    overflow: hidden;
    min-height: 80px;
  }

  .tile-inner {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 8px;
    box-sizing: border-box;
    position: relative;
  }

  .participant-avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .avatar-initials {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.5px;
  }

  .participant-name {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    padding: 0 4px;
  }

  .mute-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
