<script>
  import { activeCall } from '$lib/stores/calls.js';
  import { currentUserDetails } from '$lib/stores/api.js';

  function srcObject(node, stream) {
    node.srcObject = stream || null;
    if (stream) {
      node.play().catch(() => {});
    }
    return {
      update(newStream) {
        if (node.srcObject !== newStream) {
          node.srcObject = newStream || null;
          if (newStream) {
            node.play().catch(() => {});
          }
        }
      },
      destroy() {
        node.srcObject = null;
      }
    };
  }

  $: remoteList = $activeCall.participants || [];
  $: streams = $activeCall.participantStreams || {};
  $: localVideo = Boolean($activeCall.videoOn || $activeCall.screenOn);
  $: localStream = $activeCall.screenOn ? $activeCall.localScreenStream : $activeCall.localCameraStream;

  $: selfName = $currentUserDetails?.names?.[0]?.firstName
    ? `${$currentUserDetails.names[0].firstName} ${$currentUserDetails.names[0].lastName || ''}`.trim()
    : ($currentUserDetails?.name || 'Вы');

  $: selfParticipant = {
    id: $activeCall.myCallUserId || 'local_self',
    name: `${selfName} (Вы)`,
    avatar: $currentUserDetails?.avatar || $currentUserDetails?.photo || null,
    muted: $activeCall.muted,
    video: localVideo,
    stream: localStream,
    isSelf: true,
  };

  $: remoteParticipants = remoteList.map(p => ({
    ...p,
    stream: streams[p.id] || (remoteList.length === 1 ? $activeCall.remoteStream : null),
    isSelf: false,
  }));

  $: allParticipants = [selfParticipant, ...remoteParticipants];

  $: gridClass = (() => {
    const totalTiles = remoteList.length === 0 ? 2 : allParticipants.length;
    if (totalTiles <= 1) return 'grid--1';
    if (totalTiles === 2) return 'grid--2';
    if (totalTiles <= 4) return 'grid--4';
    if (totalTiles <= 6) return 'grid--6';
    return 'grid--many';
  })();

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function avatarColor(id) {
    const str = String(id || '');
    const palette = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#ef4444','#6366f1'];
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }
</script>

<div class="participant-grid {gridClass}">
  {#each allParticipants as p (p.id)}
    {#if !p.isSelf && p.stream}
      <audio autoplay playsinline use:srcObject={p.stream}></audio>
    {/if}

    <div class="participant-tile" class:participant-tile--self={p.isSelf}>
      {#if p.video && p.stream}
        <video
          class="tile-video"
          class:mirror={p.isSelf && !$activeCall.screenOn}
          autoplay
          playsinline
          webkit-playsinline
          muted={p.isSelf}
          use:srcObject={p.stream}
        ></video>
      {:else}
        <div class="tile-fallback">
          <div
            class="participant-avatar"
            style="background-color: {avatarColor(p.id)}; {p.avatar ? `background-image: url('${p.avatar}'); background-color: transparent;` : ''}"
          >
            {#if !p.avatar}
              <span class="avatar-initials">{initials(p.name)}</span>
            {/if}
          </div>
        </div>
      {/if}

      <div class="tile-overlay">
        <span class="participant-name">{p.name || 'Участник'}</span>
        {#if p.muted}
          <div class="mute-badge" title="Микрофон выключен">
            <img src="/icons/mic-off.svg" alt="" width="12" height="12" />
          </div>
        {/if}
      </div>
    </div>
  {/each}

  {#if remoteList.length === 0}
    <div class="participant-tile waiting-tile">
      <div class="waiting-state">
        <div class="waiting-icon">
          <img src="/icons/users.svg" alt="" width="32" height="32" />
        </div>
        <p class="waiting-label">Ожидание участников...</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .participant-grid {
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 8px;
    padding: 8px;
    box-sizing: border-box;
    align-content: center;
    justify-content: center;
  }

  .grid--1 {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }

  .grid--2 {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }

  @media (min-width: 600px) {
    .grid--2 {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr;
    }
  }

  .grid--4 {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }

  .grid--6 {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }

  @media (min-width: 600px) {
    .grid--6 {
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(2, 1fr);
    }
  }

  .grid--many {
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    grid-template-rows: repeat(auto-fill, minmax(110px, 1fr));
  }

  .participant-tile {
    position: relative;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 80px;
    box-sizing: border-box;
  }

  .participant-tile--self {
    border-color: rgba(56, 189, 248, 0.3);
  }

  .waiting-tile {
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.12);
  }

  .tile-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .tile-video.mirror {
    transform: scaleX(-1);
  }

  .tile-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at center, #1e1f2b 0%, #11121a 100%);
  }

  .participant-avatar {
    width: clamp(52px, 12vw, 80px);
    height: clamp(52px, 12vw, 80px);
    border-radius: 50%;
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .avatar-initials {
    font-size: clamp(20px, 4vw, 30px);
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.5px;
  }

  .tile-overlay {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    pointer-events: none;
  }

  .participant-name {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: #ffffff;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 3px 8px;
    border-radius: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 30px);
  }

  .mute-badge {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .waiting-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: rgba(255, 255, 255, 0.4);
    padding: 16px;
  }

  .waiting-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .waiting-label {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
  }
</style>
