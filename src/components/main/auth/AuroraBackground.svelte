<div class="aurora-container" aria-hidden="true">
  <div class="aurora-track">
    <div class="aurora-half">
      <div class="aurora-wave wave-1"></div>
      <div class="aurora-wave wave-2"></div>
      <div class="aurora-wave wave-3"></div>
      <div class="aurora-wave wave-4"></div>
    </div>
    <div class="aurora-half">
      <div class="aurora-wave wave-1"></div>
      <div class="aurora-wave wave-2"></div>
      <div class="aurora-wave wave-3"></div>
      <div class="aurora-wave wave-4"></div>
    </div>
  </div>
  <div class="aurora-overlay"></div>
</div>

<style>
  .aurora-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    height: 190px;
    overflow: hidden;
    contain: paint;
    pointer-events: none;
    z-index: 0;
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.95) 50%, rgba(0, 0, 0, 0) 100%);
    -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.95) 50%, rgba(0, 0, 0, 0) 100%);
  }

  .aurora-track {
    position: absolute;
    top: -25px;
    left: 0;
    width: 200%;
    height: 240px;
    display: flex;
    filter: blur(52px) saturate(1.6);
    will-change: transform;
    animation: aurora-flow 24s linear infinite;
  }

  .aurora-half {
    width: 50%;
    height: 100%;
    display: flex;
    flex-shrink: 0;
  }

  .aurora-wave {
    flex: 1;
    height: 100%;
    opacity: 0.96;
  }

  .wave-1 {
    background: radial-gradient(ellipse 70% 60% at 20% 35%, #8b3df8 0%, rgba(139, 61, 248, 0) 70%),
                radial-gradient(ellipse 65% 55% at 75% 30%, #0055ff 0%, rgba(0, 85, 255, 0) 70%);
  }

  .wave-2 {
    background: radial-gradient(ellipse 70% 60% at 25% 45%, #00c8ff 0%, rgba(0, 200, 255, 0) 70%),
                radial-gradient(ellipse 60% 50% at 70% 25%, #9b4bf9 0%, rgba(155, 75, 249, 0) 70%);
  }

  .wave-3 {
    background: radial-gradient(ellipse 70% 60% at 30% 35%, #0066ff 0%, rgba(0, 102, 255, 0) 70%),
                radial-gradient(ellipse 65% 55% at 80% 45%, #00d4ff 0%, rgba(0, 212, 255, 0) 70%);
  }

  .wave-4 {
    background: radial-gradient(ellipse 70% 60% at 20% 30%, #8b3df8 0%, rgba(139, 61, 248, 0) 70%),
                radial-gradient(ellipse 60% 50% at 75% 40%, #0055ff 0%, rgba(0, 85, 255, 0) 70%);
  }

  .aurora-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.25) 55%, var(--auth-bg, #ffffff) 100%);
  }

  :global(.dark-theme) .aurora-overlay,
  :global([data-theme="dark"]) .aurora-overlay {
    background: linear-gradient(180deg, rgba(18, 19, 22, 0) 0%, rgba(18, 19, 22, 0.35) 55%, var(--auth-bg, #121316) 100%);
  }

  @keyframes aurora-flow {
    0% {
      transform: translate3d(0, 0, 0);
    }
    100% {
      transform: translate3d(-50%, 0, 0);
    }
  }
</style>
