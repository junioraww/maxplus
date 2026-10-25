const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

function avatarColor(id) {
  const str = String(id || '');
  const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#6366f1'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class CallCanvasCompositor {
  #canvas = null;
  #ctx = null;
  #timer = null;
  #isRunning = false;
  #videoPool = new Map();
  #imageCache = new Map();
  #state = {
    participants: [],
    screenStream: null,
    isScreenSharing: false,
    hasAnyVideo: false,
  };

  constructor() {
    if (typeof document !== 'undefined') {
      this.#canvas = document.createElement('canvas');
      this.#canvas.width = CANVAS_WIDTH;
      this.#canvas.height = CANVAS_HEIGHT;
      this.#canvas.style.position = 'fixed';
      this.#canvas.style.top = '-9999px';
      this.#canvas.style.left = '-9999px';
      this.#canvas.style.width = `${CANVAS_WIDTH}px`;
      this.#canvas.style.height = `${CANVAS_HEIGHT}px`;
      this.#canvas.style.opacity = '0';
      this.#canvas.style.pointerEvents = 'none';
      document.body?.appendChild(this.#canvas);
      this.#ctx = this.#canvas.getContext('2d', { alpha: false });
    }
  }

  get canvas() {
    return this.#canvas;
  }

  get hasAnyVideo() {
    return this.#state.hasAnyVideo;
  }

  getCaptureStream(fps = 25) {
    if (!this.#canvas) return null;
    return this.#canvas.captureStream ? this.#canvas.captureStream(fps) : null;
  }

  updateState(partial) {
    Object.assign(this.#state, partial);
    this.#syncVideoPool();
  }

  start() {
    if (this.#isRunning || !this.#ctx) return;
    this.#isRunning = true;
    const interval = 1000 / 25;
    this.#timer = setInterval(() => {
      this.#draw();
    }, interval);
  }

  stop() {
    this.#isRunning = false;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#videoPool.forEach(el => {
      try {
        el.srcObject = null;
        el.remove();
      } catch {}
    });
    this.#videoPool.clear();
    this.#imageCache.clear();
    this.#canvas?.remove();
  }

  #syncVideoPool() {
    if (typeof document === 'undefined') return;
    const activeStreamIds = new Set();

    if (this.#state.screenStream) {
      const id = 'screen_' + (this.#state.screenStream.id || 'main');
      activeStreamIds.add(id);
      this.#getOrCreateVideo(id, this.#state.screenStream);
    }

    for (const p of this.#state.participants) {
      if (p.stream && p.hasVideo) {
        const id = 'p_' + p.id;
        activeStreamIds.add(id);
        this.#getOrCreateVideo(id, p.stream);
      }
    }

    for (const [id, el] of this.#videoPool.entries()) {
      if (!activeStreamIds.has(id)) {
        try {
          el.srcObject = null;
          el.remove();
        } catch {}
        this.#videoPool.delete(id);
      }
    }
  }

  #getOrCreateVideo(id, stream) {
    let el = this.#videoPool.get(id);
    if (!el) {
      el = document.createElement('video');
      el.muted = true;
      el.autoplay = true;
      el.playsInline = true;
      el.style.position = 'fixed';
      el.style.top = '-9999px';
      el.style.left = '-9999px';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
      this.#videoPool.set(id, el);
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
    return el;
  }

  #getImage(url) {
    if (!url) return null;
    let img = this.#imageCache.get(url);
    if (!img) {
      img = new Image();
      if (!url.startsWith('asset:') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('/')) {
        img.crossOrigin = 'anonymous';
      }
      img.src = url;
      this.#imageCache.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  #draw() {
    if (!this.#ctx) return;
    const ctx = this.#ctx;
    ctx.fillStyle = '#0f0f13';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const { participants, screenStream, isScreenSharing } = this.#state;

    let anyVideoNow = Boolean(
      (isScreenSharing && screenStream) ||
      participants.some(p => p.hasVideo)
    );

    if (anyVideoNow && !this.#state.hasAnyVideo) {
      this.#state.hasAnyVideo = true;
    }

    if (isScreenSharing && screenStream) {
      this.#drawScreenSharingLayout(ctx, screenStream, participants);
    } else {
      this.#drawGridLayout(ctx, participants);
    }
  }

  #drawScreenSharingLayout(ctx, screenStream, participants) {
    const screenW = participants.length > 0 ? 940 : 1264;
    const screenH = 704;
    const screenX = 8;
    const screenY = 8;

    const screenVideo = this.#videoPool.get('screen_' + (screenStream.id || 'main'));
    this.#drawVideoTile(ctx, screenX, screenY, screenW, screenH, screenVideo, 'Демонстрация экрана', true, false, null);

    if (participants.length > 0) {
      const colX = 956;
      const colW = 316;
      const count = Math.min(participants.length, 5);
      const gap = 8;
      const tileH = Math.floor((screenH - gap * (count - 1)) / count);

      for (let i = 0; i < count; i++) {
        const p = participants[i];
        const tileY = screenY + i * (tileH + gap);
        const pVideo = p.hasVideo ? this.#videoPool.get('p_' + p.id) : null;
        this.#drawParticipantTile(ctx, colX, tileY, colW, tileH, p, pVideo);
      }
    }
  }

  #drawGridLayout(ctx, participants) {
    const count = participants.length;
    if (count === 0) {
      this.#drawEmptyState(ctx);
      return;
    }

    if (count === 1) {
      const p = participants[0];
      const pVideo = p.hasVideo ? this.#videoPool.get('p_' + p.id) : null;
      this.#drawParticipantTile(ctx, 8, 8, CANVAS_WIDTH - 16, CANVAS_HEIGHT - 16, p, pVideo, true);
      return;
    }

    let cols = 2;
    let rows = 1;

    if (count === 2) {
      cols = 2;
      rows = 1;
    } else if (count <= 4) {
      cols = 2;
      rows = 2;
    } else if (count <= 6) {
      cols = 3;
      rows = 2;
    } else if (count <= 9) {
      cols = 3;
      rows = 3;
    } else {
      cols = 4;
      rows = 3;
    }

    const gap = 8;
    const totalW = CANVAS_WIDTH - gap * 2;
    const totalH = CANVAS_HEIGHT - gap * 2;
    const tileW = Math.floor((totalW - gap * (cols - 1)) / cols);
    const tileH = Math.floor((totalH - gap * (rows - 1)) / rows);

    const maxDraw = Math.min(count, cols * rows);

    for (let i = 0; i < maxDraw; i++) {
      const p = participants[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gap + col * (tileW + gap);
      const y = gap + row * (tileH + gap);

      if (i === maxDraw - 1 && count > maxDraw) {
        this.#drawOverflowTile(ctx, x, y, tileW, tileH, count - maxDraw + 1);
      } else {
        const pVideo = p.hasVideo ? this.#videoPool.get('p_' + p.id) : null;
        this.#drawParticipantTile(ctx, x, y, tileW, tileH, p, pVideo);
      }
    }
  }

  #drawParticipantTile(ctx, x, y, w, h, p, videoEl, isLarge = false) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();

    ctx.fillStyle = '#16161e';
    ctx.fillRect(x, y, w, h);

    const sourceCanvas = Boolean(p.hasVideo) && p.canvasElement && p.canvasElement.width > 0 && p.canvasElement.height > 0
      ? p.canvasElement
      : (Boolean(p.hasVideo) && typeof document !== 'undefined'
          ? document.querySelector('canvas.remote-video, canvas.tile-video')
          : null);

    const hasActiveCanvas = Boolean(p.hasVideo && sourceCanvas && sourceCanvas.width > 0 && sourceCanvas.height > 0);
    const hasActiveVideo = Boolean(p.hasVideo && videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0);

    if (hasActiveCanvas) {
      this.#drawAspectCanvas(ctx, sourceCanvas, x, y, w, h);
    } else if (hasActiveVideo) {
      this.#drawAspectVideo(ctx, videoEl, x, y, w, h);
    } else {
      this.#drawAvatarCard(ctx, p, x, y, w, h, isLarge);
    }

    ctx.restore();

    if (p.isSpeaking) {
      p.speakingGlow = Math.min(1.0, (p.speakingGlow || 0) + 0.25);
    } else {
      p.speakingGlow = Math.max(0.0, (p.speakingGlow || 0) - 0.1);
    }

    if (p.speakingGlow > 0.01) {
      ctx.save();
      const alpha = 0.25 + 0.75 * p.speakingGlow;
      ctx.strokeStyle = `rgba(34, 197, 94, ${alpha})`;
      ctx.lineWidth = 2.5 + 2 * p.speakingGlow;
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 12 * p.speakingGlow;
      roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 11);
      ctx.stroke();
      ctx.restore();
    }

    this.#drawNameBadge(ctx, x, y, w, h, p.name || 'Участник', p.isMuted);
  }

  #drawAspectCanvas(ctx, sourceCanvas, x, y, w, h, contain = false) {
    const cw = sourceCanvas.width;
    const ch = sourceCanvas.height;
    if (cw <= 0 || ch <= 0) return;

    const targetRatio = w / h;
    const canvasRatio = cw / ch;

    let sx = 0;
    let sy = 0;
    let sw = cw;
    let sh = ch;

    if (contain) {
      let dw = w;
      let dh = h;
      let dx = x;
      let dy = y;
      if (canvasRatio > targetRatio) {
        dh = w / canvasRatio;
        dy = y + (h - dh) / 2;
      } else {
        dw = h * canvasRatio;
        dx = x + (w - dw) / 2;
      }
      ctx.drawImage(sourceCanvas, dx, dy, dw, dh);
    } else {
      if (canvasRatio > targetRatio) {
        sw = ch * targetRatio;
        sx = (cw - sw) / 2;
      } else {
        sh = cw / targetRatio;
        sy = (ch - sh) / 2;
      }
      ctx.drawImage(sourceCanvas, sx, sy, sw, sh, x, y, w, h);
    }
  }

  #drawVideoTile(ctx, x, y, w, h, videoEl, label, isScreenshare, isSpeaking, muted) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();

    ctx.fillStyle = '#16161e';
    ctx.fillRect(x, y, w, h);

    if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      this.#drawAspectVideo(ctx, videoEl, x, y, w, h, isScreenshare);
    }

    ctx.restore();

    if (isSpeaking) {
      ctx.save();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 11);
      ctx.stroke();
      ctx.restore();
    }

    if (label) {
      this.#drawNameBadge(ctx, x, y, w, h, label, muted);
    }
  }

  #drawAspectVideo(ctx, videoEl, x, y, w, h, contain = false) {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (vw <= 0 || vh <= 0) return;

    const targetRatio = w / h;
    const videoRatio = vw / vh;

    let dw = w;
    let dh = h;
    let dx = x;
    let dy = y;

    if (contain) {
      if (videoRatio > targetRatio) {
        dh = w / videoRatio;
        dy = y + (h - dh) / 2;
      } else {
        dw = h * videoRatio;
        dx = x + (w - dw) / 2;
      }
      ctx.drawImage(videoEl, dx, dy, dw, dh);
    } else {
      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;

      if (videoRatio > targetRatio) {
        sw = vh * targetRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / targetRatio;
        sy = (vh - sh) / 2;
      }
      ctx.drawImage(videoEl, sx, sy, sw, sh, x, y, w, h);
    }
  }

  #drawAvatarCard(ctx, p, x, y, w, h, isLarge) {
    const avatarImg = p.avatar ? this.#getImage(p.avatar) : null;

    if (avatarImg) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.drawImage(avatarImg, x, y, w, h);
      ctx.restore();
    }

    const radius = isLarge ? Math.min(80, Math.floor(h * 0.18)) : Math.min(48, Math.floor(h * 0.22));
    const cx = x + w / 2;
    const cy = y + h / 2 - 8;

    if (p.speakingGlow > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4 + p.speakingGlow * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34, 197, 94, ${0.45 * p.speakingGlow})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    if (avatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = avatarColor(p.id);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${Math.floor(radius * 0.75)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(p.name), cx, cy);
      ctx.restore();
    }
  }

  #drawNameBadge(ctx, x, y, w, h, name, isMuted) {
    ctx.save();
    const fontSize = Math.max(11, Math.min(14, Math.floor(h * 0.07)));
    ctx.font = `500 ${fontSize}px sans-serif`;

    const textWidth = ctx.measureText(name).width;
    const badgeW = textWidth + (isMuted ? 32 : 18);
    const badgeH = fontSize + 10;
    const badgeX = x + 10;
    const badgeY = y + h - badgeH - 10;

    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
    ctx.fillStyle = 'rgba(10, 10, 15, 0.72)';
    ctx.fill();

    ctx.fillStyle = '#f3f4f6';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, badgeX + 8, badgeY + badgeH / 2);

    if (isMuted) {
      ctx.strokeStyle = '#ef4444';
      ctx.fillStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      const iconX = badgeX + textWidth + 18;
      const iconY = badgeY + badgeH / 2;
      ctx.beginPath();
      ctx.arc(iconX, iconY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  #drawOverflowTile(ctx, x, y, w, h, remainingCount) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    ctx.fillStyle = '#1c1c27';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '600 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${remainingCount}`, x + w / 2, y + h / 2);
    ctx.restore();
  }

  #drawEmptyState(ctx) {
    ctx.save();
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Ожидание подключения участников...', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.restore();
  }
}
