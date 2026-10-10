<script>
  import IconButton from "$components/ui/IconButton.svelte";
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { fade } from "svelte/transition";
  import { getCreditsGrouped } from "$lib/services/credits";

  const dispatch = createEventDispatcher();

  // Kevin MacLeod — Fanfare for Space
  // Creative Commons: By Attribution 4.0
  const AUDIO_MIRRORS = [
    "https://upload.wikimedia.org/wikipedia/commons/5/50/Fanfare_for_Space_%28ISRC_USUAN1300026%29.mp3",
    "https://upload.wikimedia.org/wikipedia/commons/f/f7/Kevin_MacLeod_-_Fanfare_for_Space.ogg",
    "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Fanfare%20for%20Space.mp3"
  ];

  let starCanvasEl;
  let webglCanvasEl;
  let animFrameId;
  let abortController = null;

  let audioCtx = null;
  let audioBuffer = null;
  let sourceNode = null;
  let gainNode = null;
  let audioStartTime = 0;
  let pauseOffset = 0;
  let isAudioPlaying = false;

  let groups = {
    contributor: [],
    supporter: [],
    tester: []
  };

  let stage = "loading";
  let isPaused = false;
  let isMuted = false;
  let isCancelled = false;

  let progress = -0.04;
  let crawlSpeed = 0.000014;
  let isDragging = false;
  let lastDragY = 0;
  let introTimer = null;
  let maxProgress = 1.0;
  let stars = [];
  let priorBodyOverflow = "";
  let priorHtmlOverflow = "";

  let gl = null;
  let shaderProgram = null;
  let positionBuffer = null;
  let uvBuffer = null;
  let indexBuffer = null;
  let textTexture = null;
  let indexCount = 0;

  function renderTextToCanvas(data) {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 4096;
    const ctx = c.getContext("2d");
    if (!ctx) return { canvas: c, contentHeight: 4096 };

    ctx.clearRect(0, 0, 1024, 4096);

    let curY = 140;

    ctx.textAlign = "center";
    ctx.fillStyle = "#feda4a";

    ctx.font = "bold 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("ЭПИЗОД 6", 512, curY);
    curY += 76;

    ctx.font = "900 74px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("ВОЗВРАЩЕНИЕ МАКСА", 512, curY);
    curY += 110;

    function drawParagraph(text) {
      ctx.font = "700 42px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#feda4a";
      const words = text.split(" ");
      let line = "";
      for (const w of words) {
        const testLine = line ? line + " " + w : w;
        if (ctx.measureText(testLine).width > 860) {
          ctx.fillText(line, 512, curY);
          curY += 60;
          line = w;
        } else {
          line = testLine;
        }
      }
      if (line) {
        ctx.fillText(line, 512, curY);
        curY += 60;
      }
      curY += 45;
    }

    drawParagraph(
      "Мрак и паранойя поглотили просторы Рунета. Зловещий альянс Роскомнадзора и ненасытной мегакорпорации сомкнул железный кулак цензуры, превратив цифровое пространство в стерильный электронный концлагерь."
    );

    drawParagraph(
      "Их коварный план абсолютен: тотальная слежка за каждым кликом, каждым вздохом и каждым гражданином. Удушающие блокировки уничтожают остатки свободного интернета, а неповоротливые монстры выкачивают персональные данные, скармливая людям гигабайты мусора, рекламы и стукаческих трекеров."

    );

    drawParagraph(
      "Но на руинах цифровой свободы зародилось дерзкое Сопротивление. Бросив вызов цензорам РКН и имперской машине, независимые разработчики выковали проект MAX+ — несокрушимый рубеж приватности, сметающий надзор и возвращающий связь народу."
    );

    drawParagraph(
      "Перед вами имена бесстрашных мятежников, чья отвага не позволит превратить Рунет в безмолвную цифровую тюрьму..."
    );

    function drawHeading(text) {
      curY += 30;
      ctx.font = "bold 48px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#feda4a";
      ctx.fillText(text, 512, curY);
      const tw = ctx.measureText(text).width;
      ctx.strokeStyle = "rgba(254, 218, 74, 0.4)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(512 - tw / 2, curY + 14);
      ctx.lineTo(512 + tw / 2, curY + 14);
      ctx.stroke();
      curY += 65;
    }

    function drawNames(list) {
      ctx.font = "600 44px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#ffffff";
      for (const item of list) {
        ctx.fillText(item.name, 512, curY);
        curY += 56;
      }
      curY += 30;
    }

    if (data.contributor && data.contributor.length > 0) {
      drawHeading("РАЗРАБОТКА");
      drawNames(data.contributor);
    }

    if (data.supporter && data.supporter.length > 0) {
      drawHeading("ПОДДЕРЖКА ПРОЕКТА");
      drawNames(data.supporter);
    }

    if (data.tester && data.tester.length > 0) {
      drawHeading("ТЕСТИРОВАНИЕ");
      drawNames(data.tester);
    }

    curY += 20;

    ctx.save();
    ctx.translate(512, curY);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-15, -20, -38, 0, 0, 36);
    ctx.bezierCurveTo(38, 0, 15, -20, 0, 0);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.restore();

    curY += 90;
    ctx.font = "900 52px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#feda4a";
    ctx.fillText("Да пребудет с вами", 512, curY);
    curY += 60;
    ctx.fillText("анонимность!", 512, curY);
    curY += 150;

    return { canvas: c, contentHeight: curY };
  }

  function initWebGL() {
    if (!webglCanvasEl) return false;
    gl = webglCanvasEl.getContext("webgl", { alpha: true, premultipliedAlpha: false });
    if (!gl) return false;

    const vsSource = `
      attribute vec3 aPosition;
      attribute vec2 aUv;
      uniform float uAspect;
      varying vec2 vUv;
      varying float vZ;

      void main() {
        vZ = aPosition.z;
        vUv = aUv;
        gl_Position = vec4(aPosition.x / uAspect, aPosition.y, aPosition.z * 0.1, aPosition.z);
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 vUv;
      varying float vZ;
      uniform sampler2D uTexture;
      uniform float uProgress;

      void main() {
        float windowSize = 0.28;
        float v = uProgress - vUv.y * windowSize;
        if (v < 0.0 || v > 1.0) {
          discard;
        }
        vec4 color = texture2D(uTexture, vec2(vUv.x, v));
        float horizonFade = smoothstep(3.8, 2.5, vZ);
        float bottomFade = smoothstep(1.0, 1.15, vZ);
        gl_FragColor = vec4(color.rgb, color.a * horizonFade * bottomFade);
      }
    `;

    function createShader(type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    }

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);

    shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vs);
    gl.attachShader(shaderProgram, fs);
    gl.linkProgram(shaderProgram);

    const cols = 16;
    const rows = 32;
    const pos = [];
    const uvs = [];
    const indices = [];

    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const y = -0.85 + 3.25 * t;
      const z = 1.0 + 2.8 * t;
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const x = -1 + 2 * u;
        pos.push(x, y, z);
        uvs.push(u, t);
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = r * (cols + 1) + c;
        const i1 = i0 + 1;
        const i2 = (r + 1) * (cols + 1) + c;
        const i3 = i2 + 1;
        indices.push(i0, i1, i2, i2, i1, i3);
      }
    }

    indexCount = indices.length;

    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);

    uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return true;
  }

  function uploadTexture(canvasSource) {
    if (!gl) return;
    if (textTexture) {
      gl.deleteTexture(textTexture);
    }
    textTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function playAudioFromStart() {
    if (!audioCtx || !audioBuffer) return;
    if (sourceNode) {
      try {
        sourceNode.stop();
        sourceNode.disconnect();
      } catch (err) {}
      sourceNode = null;
    }

    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(isMuted ? 0 : 0.85, audioCtx.currentTime);
    gainNode.connect(audioCtx.destination);

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.loop = false;
    sourceNode.connect(gainNode);
    sourceNode.start(0, 0);

    audioStartTime = audioCtx.currentTime;
    pauseOffset = 0;
    isAudioPlaying = true;
  }

  function pauseAudio() {
    if (!audioCtx || !sourceNode || !isAudioPlaying) return;
    pauseOffset = Math.max(0, audioCtx.currentTime - audioStartTime);
    try {
      sourceNode.stop();
      sourceNode.disconnect();
    } catch (err) {}
    sourceNode = null;
    isAudioPlaying = false;
  }

  function resumeAudio() {
    if (!audioCtx || !audioBuffer || isAudioPlaying) return;
    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(isMuted ? 0 : 0.85, audioCtx.currentTime);
    gainNode.connect(audioCtx.destination);

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.loop = false;
    sourceNode.connect(gainNode);
    sourceNode.start(0, pauseOffset % audioBuffer.duration);

    audioStartTime = audioCtx.currentTime - pauseOffset;
    isAudioPlaying = true;
  }

  function close() {
    if (isCancelled) return;
    isCancelled = true;

    if (abortController) {
      abortController.abort();
    }
    clearTimeout(introTimer);

    if (sourceNode) {
      try {
        sourceNode.stop();
        sourceNode.disconnect();
      } catch (err) {}
      sourceNode = null;
    }
    if (audioCtx) {
      try {
        audioCtx.close();
      } catch (err) {}
      audioCtx = null;
    }

    dispatch("close");
  }

  function togglePause() {
    if (stage !== "crawl") return;
    isPaused = !isPaused;
    if (isPaused) {
      pauseAudio();
    } else {
      resumeAudio();
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (gainNode && audioCtx) {
      gainNode.gain.setValueAtTime(isMuted ? 0 : 0.85, audioCtx.currentTime);
    }
  }

  function restart() {
    clearTimeout(introTimer);
    playAudioFromStart();
    isPaused = false;
    progress = -0.04;
    stage = "intro";
    runIntroSequence();
  }

  function skipIntro() {
    clearTimeout(introTimer);
    stage = "crawl";
    progress = -0.04;
  }

  function handleWheel(e) {
    if (stage !== "crawl") return;
    e.preventDefault();
    progress = Math.max(-0.06, progress + e.deltaY * 0.00035);
    checkCrawlEnd();
  }

  function handlePointerDown(e) {
    if (stage !== "crawl") return;
    isDragging = true;
    lastDragY = e.clientY;
  }

  function handlePointerMove(e) {
    if (!isDragging || stage !== "crawl") return;
    const dy = e.clientY - lastDragY;
    lastDragY = e.clientY;
    progress = Math.max(-0.06, progress - dy * 0.0005);
    checkCrawlEnd();
  }

  function handlePointerUp() {
    isDragging = false;
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      close();
    } else if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      togglePause();
    } else if (e.key === "m" || e.key === "M" || e.key === "ь" || e.key === "Ь") {
      e.preventDefault();
      toggleMute();
    } else if (e.key === "ArrowUp") {
      if (stage === "crawl") {
        e.preventDefault();
        progress = Math.max(-0.06, progress + 0.025);
        checkCrawlEnd();
      }
    } else if (e.key === "ArrowDown") {
      if (stage === "crawl") {
        e.preventDefault();
        progress = Math.max(-0.06, progress - 0.025);
      }
    }
  }

  function checkCrawlEnd() {
    if (progress > maxProgress) {
      close();
    }
  }

  function initStarfield(width, height) {
    const count = 180;
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.5 + 0.3,
        alpha: Math.random() * 0.8 + 0.2,
        twinkleSpeed: (Math.random() * 0.02 + 0.005) * (Math.random() < 0.5 ? 1 : -1)
      });
    }
  }

  function renderStars(ctx, width, height) {
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      star.alpha += star.twinkleSpeed;
      if (star.alpha > 1) {
        star.alpha = 1;
        star.twinkleSpeed = -star.twinkleSpeed;
      } else if (star.alpha < 0.2) {
        star.alpha = 0.2;
        star.twinkleSpeed = -star.twinkleSpeed;
      }
      ctx.fillStyle = "rgba(255, 255, 255," + star.alpha.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function renderWebGLCrawl() {
    if (!gl || !shaderProgram || !textTexture) return;

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(shaderProgram);

    const aspect = gl.canvas.width / gl.canvas.height;
    const uAspectLoc = gl.getUniformLocation(shaderProgram, "uAspect");
    const uProgressLoc = gl.getUniformLocation(shaderProgram, "uProgress");
    const uTextureLoc = gl.getUniformLocation(shaderProgram, "uTexture");

    gl.uniform1f(uAspectLoc, aspect);
    gl.uniform1f(uProgressLoc, progress);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.uniform1i(uTextureLoc, 0);

    const posAttr = gl.getAttribLocation(shaderProgram, "aPosition");
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);

    const uvAttr = gl.getAttribLocation(shaderProgram, "aUv");
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.enableVertexAttribArray(uvAttr);
    gl.vertexAttribPointer(uvAttr, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
  }

  function startMainLoop() {
    let lastTime = performance.now();

    function frame(now) {
      const dt = Math.min(40, now - lastTime);
      lastTime = now;

      if (starCanvasEl) {
        const sCtx = starCanvasEl.getContext("2d");
        if (sCtx) {
          sCtx.clearRect(0, 0, starCanvasEl.width, starCanvasEl.height);
          renderStars(sCtx, starCanvasEl.width, starCanvasEl.height);
        }
      }

      if (stage === "crawl") {
        if (!isPaused && !isDragging) {
          progress += crawlSpeed * dt;
          checkCrawlEnd();
        }
        renderWebGLCrawl();
      }

      animFrameId = requestAnimationFrame(frame);
    }

    animFrameId = requestAnimationFrame(frame);
  }

  function runIntroSequence() {
    stage = "intro";
    introTimer = setTimeout(() => {
      if (isCancelled) return;
      stage = "crawl";
      progress = -0.04;
    }, 3600);
  }

  async function downloadAudioWithMirrors(signal) {
    for (const mirror of AUDIO_MIRRORS) {
      if (signal.aborted) return null;
      try {
        const res = await fetch(mirror, { signal });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          if (signal.aborted) return null;
          const context = new (window.AudioContext || window.webkitAudioContext)();
          const decoded = await context.decodeAudioData(arrayBuf);
          return { ctx: context, buffer: decoded };
        }
      } catch (err) {
        if (signal.aborted) return null;
      }
    }
    return null;
  }

  function resizeCanvases() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (starCanvasEl) {
      starCanvasEl.width = w;
      starCanvasEl.height = h;
      initStarfield(w, h);
    }
    if (webglCanvasEl) {
      webglCanvasEl.width = w;
      webglCanvasEl.height = h;
    }
  }

  onMount(async () => {
    window.addEventListener("keydown", handleKeydown);

    if (typeof document !== "undefined") {
      priorBodyOverflow = document.body.style.overflow;
      priorHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }

    resizeCanvases();
    window.addEventListener("resize", resizeCanvases);

    initWebGL();
    startMainLoop();

    abortController = new AbortController();

    const dataPromise = getCreditsGrouped(true)
      .then((res) => {
        groups = res;
        const rendered = renderTextToCanvas(groups);
        uploadTexture(rendered.canvas);
        maxProgress = (rendered.contentHeight / 4096) + 0.16;
      })
      .catch(() => {
        const rendered = renderTextToCanvas(groups);
        uploadTexture(rendered.canvas);
        maxProgress = (rendered.contentHeight / 4096) + 0.16;
      });

    const audioPromise = downloadAudioWithMirrors(abortController.signal).then((audioRes) => {
      if (audioRes && !isCancelled) {
        audioCtx = audioRes.ctx;
        audioBuffer = audioRes.buffer;
      }
    });

    await Promise.all([dataPromise, audioPromise]);

    if (isCancelled) return;

    playAudioFromStart();
    runIntroSequence();

    return () => {
      window.removeEventListener("resize", resizeCanvases);
    };
  });

  onDestroy(() => {
    close();
    window.removeEventListener("keydown", handleKeydown);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (typeof document !== "undefined") {
      document.body.style.overflow = priorBodyOverflow;
      document.documentElement.style.overflow = priorHtmlOverflow;
    }
  });
</script>

<div class="sw-backdrop" transition:fade={{ duration: 250 }}>
  <canvas bind:this={starCanvasEl} class="star-canvas"></canvas>

  <canvas
    bind:this={webglCanvasEl}
    class="webgl-canvas"
    on:wheel|passive={handleWheel}
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointercancel={handlePointerUp}
  ></canvas>

  <div class="top-nav">
    <div class="nav-cluster left">
      {#if stage === "intro"}
        <IconButton class="creditsmodal-icon-btn creditsmodal-action-text-btn" onclick={skipIntro}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 4 15 12 5 20 5 4"></polygon>
            <line x1="19" y1="5" x2="19" y2="19"></line>
          </svg>
          <span>Пропустить</span>
        </IconButton>
      {/if}
    </div>

    <div class="nav-cluster right">
      <IconButton variant="outline" onclick={toggleMute} aria-label="Звук">
        {#if isMuted}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
        {/if}
      </IconButton>

      {#if stage === "crawl"}
        <IconButton variant="outline" onclick={togglePause} aria-label="Пауза">
          {#if isPaused}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
          {/if}
        </IconButton>

        <IconButton variant="outline" onclick={restart} aria-label="Сначала">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
        </IconButton>
      {/if}

      <IconButton class="creditsmodal-icon-btn creditsmodal-close-btn" onclick={close} aria-label="Закрыть">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </IconButton>
    </div>
  </div>

  {#if stage === "loading"}
    <div class="loader-backdrop" transition:fade={{ duration: 200 }}>
      <div class="spinner-box">
        <svg class="spinner-svg" viewBox="0 0 48 48" width="48" height="48">
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(254, 218, 74, 0.15)" stroke-width="3"></circle>
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="#feda4a"
            stroke-width="3"
            stroke-dasharray="80"
            stroke-dashoffset="20"
            stroke-linecap="round"
          ></circle>
        </svg>
      </div>
    </div>
  {:else if stage === "intro"}
    <div class="scene-stage intro-center" transition:fade={{ duration: 400 }}>
      <p class="intro-blue-text">
        Давным-давно, в одном далёком-далёком<br />мессенджере...
      </p>
    </div>
  {:else if stage === "crawl"}
    <div class="bottom-hint">
      <span>Пробел — пауза • Колесико / свайп — перемотка • M — звук • Esc — выход</span>
    </div>
  {/if}
</div>

<style>
  .sw-backdrop {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: #000000;
    z-index: 999999;
    overflow: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .sw-backdrop::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .star-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }

  .webgl-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    cursor: grab;
    touch-action: none;
  }

  .webgl-canvas:active {
    cursor: grabbing;
  }

  .top-nav {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 16px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 10;
  }

  .nav-cluster {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  :global(.creditsmodal-icon-btn)  { width: 40px; }

  :global(.creditsmodal-icon-btn):hover  { transform: scale(1.05); }

  :global(.creditsmodal-icon-btn):active  { transform: scale(0.96); }

  :global(.creditsmodal-action-text-btn)  { width: auto; }


  .loader-backdrop {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 5;
    pointer-events: none;
  }

  .spinner-box {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .spinner-svg {
    width: 48px;
    height: 48px;
    animation: spinCircle 1.2s linear infinite;
    transform-origin: 24px 24px;
  }

  @keyframes spinCircle {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .scene-stage {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .intro-blue-text {
    color: #4bd5ee;
    font-size: clamp(1.4rem, 3.2vw, 2.4rem);
    font-weight: 600;
    text-align: center;
    line-height: 1.5;
    max-width: 800px;
    padding: 0 24px;
    letter-spacing: 0.02em;
    filter: drop-shadow(0 0 16px rgba(75, 213, 238, 0.4));
  }

  .bottom-hint {
    position: absolute;
    bottom: 14px;
    left: 0;
    right: 0;
    text-align: center;
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    pointer-events: none;
    z-index: 10;
  }

  @media (max-width: 640px) {
    .top-nav {
      padding: 12px 16px;
    }
    .bottom-hint {
      display: none;
    }
  }
</style>
