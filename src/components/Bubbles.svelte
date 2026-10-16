<script>
  import { onMount, onDestroy } from "svelte";

  export let bubbleCount = 30;
  export let colors = [
    "rgba(255,255,255,0.35)",
    "rgba(200,230,255,0.25)",
    "rgba(180,210,255,0.18)",
  ];
  export let minRadius = 14;
  export let maxRadius = 38;
  export let speed = 0.6;
  export let parallax = false;

  let canvas;
  let ctx;
  let rafId;

  let particles = [];

  let width = 0;
  let height = 0;
  let dpr = 1;

  let pointerX = 0.5;
  let pointerY = 0.5;

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function initParticles() {
    particles = [];

    for (let i = 0; i < bubbleCount; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        vx: rand(-0.0003, 0.0003) * speed,
        vy: -rand(0.0002, 0.0008) * speed,
        r: rand(minRadius, maxRadius),
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: rand(0.06, 0.28),
      });
    }
  }

  let spriteMap = {};

  function initSprites() {
    spriteMap = {};
    for (const color of colors) {
      const size = 128;
      const offCanvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(size, size)
        : document.createElement("canvas");
      offCanvas.width = size;
      offCanvas.height = size;
      const sCtx = offCanvas.getContext("2d");
      const r = size / 2;
      const g = sCtx.createRadialGradient(r - r * 0.3, r - r * 0.4, r * 0.1, r, r, r);
      g.addColorStop(0, color);
      g.addColorStop(1, color);
      sCtx.fillStyle = g;
      sCtx.beginPath();
      sCtx.arc(r, r, r, 0, Math.PI * 2);
      sCtx.fill();
      spriteMap[color] = offCanvas;
    }
  }

  function resize() {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    width = rect.width;
    height = rect.height;

    dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    ctx = canvas.getContext("2d");

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      const px = p.x * width;
      const py = p.y * height;

      const offsetX = parallax ? (pointerX - 0.5) * 20 : 0;
      const offsetY = parallax ? (pointerY - 0.5) * 20 : 0;

      const x = px + offsetX;
      const y = py + offsetY;

      ctx.globalAlpha = p.alpha;

      const sprite = spriteMap[p.color];
      if (sprite) {
        ctx.drawImage(sprite, x - p.r, y - p.r, p.r * 2, p.r * 2);
      }
    }

    ctx.globalAlpha = 1;
  }

  function update() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.y < -0.1) p.y = 1.1;
      if (p.y > 1.1) p.y = -0.1;

      if (p.x < -0.1) p.x = 1.1;
      if (p.x > 1.1) p.x = -0.1;
    }
  }

  let lastFrameTime = 0;
  let isVisible = true;
  let isPageVisible = true;
  let isUserActive = true;
  let idleTimeout = null;
  let observer = null;

  function wakeUp() {
    isUserActive = true;
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      isUserActive = false;
    }, 4000);
    startLoop();
  }

  function loop(timestamp = 0) {
    if (!isVisible || !isPageVisible) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(loop);
    const targetFps = isUserActive ? 30 : 10;
    const frameInterval = 1000 / targetFps;
    const elapsed = timestamp - lastFrameTime;
    if (elapsed < frameInterval) return;
    lastFrameTime = timestamp - (elapsed % frameInterval);

    update();
    draw();
  }

  function startLoop() {
    if (!rafId && isVisible && isPageVisible) {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function handleVisibilityChange() {
    isPageVisible = document.visibilityState !== "hidden";
    if (isPageVisible) {
      startLoop();
    } else {
      stopLoop();
    }
  }

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();

    let clientX, clientY;

    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    pointerX = (clientX - rect.left) / rect.width;
    pointerY = (clientY - rect.top) / rect.height;
  }

  onMount(() => {
    initSprites();
    resize();
    initParticles();
    wakeUp();

    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pointerdown", wakeUp, { passive: true });
    window.addEventListener("touchstart", wakeUp, { passive: true });
    window.addEventListener("scroll", wakeUp, { passive: true });

    if (typeof IntersectionObserver !== "undefined" && canvas) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          isVisible = entry.isIntersecting;
          if (isVisible) {
            wakeUp();
          } else {
            stopLoop();
          }
        }
      });
      observer.observe(canvas);
    }

    if (parallax) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("touchmove", onPointerMove, { passive: true });
    }

    startLoop();
  });

  onDestroy(() => {
    stopLoop();
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pointerdown", wakeUp);
    window.removeEventListener("touchstart", wakeUp);
    window.removeEventListener("scroll", wakeUp);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("touchmove", onPointerMove);
  });
</script>

<div class="bubbles-wrapper" aria-hidden="true">
  <canvas bind:this={canvas} class="bubbles-canvas"></canvas>
</div>

<style>
  :global(.bubbles-wrapper) {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
