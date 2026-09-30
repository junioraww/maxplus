<script>
  import { fade } from "svelte/transition";
  import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
  import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import { registerBackHandler } from "$lib/utils/backButton.js";
  import { getAssetUrl } from "$lib/utils/images";
  import API, { currentUserDetails } from "$lib/stores/api";

  export let initialUrl = null;
  export let initialPhotoId = null;
  export let userId = null;
  export let isOwnProfile = false;
  export let canUpload = false;
  export let originRect = null;
  export let originEl = null;
  export let originRadius = 50;
  export let onUpload = null;
  export let onDelete = null;
  export let onDownloaded = null;
  export let onError = null;

  const dispatch = createEventDispatcher();

  function parsePhotoIdFromUrl(url) {
    if (typeof url !== "string" || !url) return null;
    try {
      const parsed = new URL(url);
      for (const key of ["photoId", "id", "i"]) {
        const val = parsed.searchParams.get(key);
        if (val && /^\d{5,20}$/.test(val)) return Number(val);
      }
      const segments = parsed.pathname.split("/").filter(Boolean);
      for (let i = segments.length - 1; i >= 0; i--) {
        const clean = segments[i].replace(/\.(jpg|jpeg|png|webp)$/i, "");
        if (/^\d{6,20}$/.test(clean)) return Number(clean);
      }
    } catch {}
    const match = url.match(/(?:photoId=|id=|\/)(\d{6,20})(?:[/?&.]|$)/);
    return match ? Number(match[1]) : null;
  }

  let items = initialUrl
    ? [{ url: initialUrl, photoId: initialPhotoId || parsePhotoIdFromUrl(initialUrl) }]
    : [];
  let totalCount = items.length;
  let currentIndex = 0;
  let isLoadingHistory = false;
  let historyEndReached = false;
  let isDownloading = false;
  let isUploading = false;
  let isDeleting = false;

  let resolvedUrlMap = {};
  let stageEl;
  let mainImgEl;

  let scale = 1;
  let x = 0;
  let y = 0;
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;

  let slideOffset = 0;
  let isSlideAnimating = false;
  let slideAnimFrame = null;

  let heroPhase = "idle";
  let heroStyle = "";
  let backdropOpacity = 1;
  let uiOpacity = 1;
  let isClosing = false;

  let activePointers = new Map();
  let isDragging = false;
  let dragAxis = null;
  let wasGestureMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartMidX = 0;
  let pinchStartMidY = 0;
  let pinchOriginX = 0;
  let pinchOriginY = 0;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let animFrameId = null;

  const unregisterBack = registerBackHandler(() => {
    requestClose();
    return false;
  });

  function getOriginCoreEl() {
    if (!originEl) return null;
    return originEl.querySelector?.(".avatar-container") || originEl;
  }

  function getOriginBadges() {
    if (!originEl || typeof originEl.querySelectorAll !== "function") return [];
    return Array.from(
      originEl.querySelectorAll(".tg-avatar-edit-badge, .avatar-camera-badge, .online-badge, .selection-overlay")
    );
  }

  function fadeOutOriginBadges() {
    const badges = getOriginBadges();
    for (const b of badges) {
      if (b && b.style) {
        b.style.transition = "opacity 160ms ease-out, transform 160ms ease-out";
        b.style.opacity = "0";
        b.style.transform = "scale(0.65)";
      }
    }
  }

  function fadeInOriginBadges(delayMs = 0) {
    const badges = getOriginBadges();
    if (!badges.length) return;
    const run = () => {
      for (const b of badges) {
        if (b && b.style) {
          b.style.transition = "opacity 200ms ease-out, transform 200ms cubic-bezier(0.22, 1, 0.36, 1)";
          b.style.opacity = "1";
          b.style.transform = "scale(1)";
        }
      }
      setTimeout(() => {
        for (const b of badges) {
          if (b && b.style) {
            b.style.transition = "";
            b.style.opacity = "";
            b.style.transform = "";
          }
        }
      }, 220);
    };
    if (delayMs > 0) {
      setTimeout(run, delayMs);
    } else {
      run();
    }
  }

  function hideOriginImageImmediate() {
    const core = getOriginCoreEl();
    if (core && core.style) {
      core.style.transition = "none";
      core.style.opacity = "0";
    }
    fadeOutOriginBadges();
  }

  function restoreOriginEl(smooth = false) {
    const core = getOriginCoreEl();
    if (core && core.style) {
      if (smooth) {
        core.style.transition = "opacity 220ms ease-out";
        core.style.opacity = "1";
        setTimeout(() => {
          if (core && core.style) {
            core.style.transition = "";
            core.style.opacity = "";
          }
        }, 240);
      } else {
        core.style.transition = "";
        core.style.opacity = "";
      }
    }
    if (originEl && originEl.style && originEl !== core) {
      originEl.style.transition = "";
      originEl.style.opacity = "";
    }
    fadeInOriginBadges(0);
  }

  onDestroy(() => {
    const core = getOriginCoreEl();
    if (core && core.style) {
      core.style.transition = "";
      core.style.opacity = "";
    }
    for (const b of getOriginBadges()) {
      if (b && b.style) {
        b.style.transition = "";
        b.style.opacity = "";
        b.style.transform = "";
      }
    }
    stopAnim();
    stopSlideAnim();
    unregisterBack();
  });

  function getActiveOriginRect() {
    const target = getOriginCoreEl();
    if (target && typeof target.getBoundingClientRect === "function" && document.body.contains(target)) {
      const r = target.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) {
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
      return null;
    }
    if (originRect && originRect.width > 0 && originRect.height > 0) {
      if (
        originRect.top + originRect.height > 0 &&
        originRect.top < window.innerHeight &&
        originRect.left + originRect.width > 0 &&
        originRect.left < window.innerWidth
      ) {
        return originRect;
      }
    }
    return null;
  }

  function getStageCenter() {
    if (stageEl && typeof stageEl.getBoundingClientRect === "function") {
      const sr = stageEl.getBoundingClientRect();
      if (sr.width > 0 && sr.height > 0) {
        return { cx: sr.left + sr.width / 2, cy: sr.top + sr.height / 2 };
      }
    }
    return { cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
  }

  function getTargetImageBox() {
    const { cx, cy } = getStageCenter();
    if (mainImgEl && mainImgEl.offsetWidth > 0 && mainImgEl.offsetHeight > 0) {
      return { width: mainImgEl.offsetWidth, height: mainImgEl.offsetHeight, cx, cy };
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = vw * 0.94;
    const maxH = vh * 0.80;
    let natW = mainImgEl?.naturalWidth || 0;
    let natH = mainImgEl?.naturalHeight || 0;
    if (!natW || !natH) {
      const size = Math.min(maxW, maxH, 520);
      return { width: size, height: size, cx, cy };
    }
    const ratio = Math.min(maxW / natW, maxH / natH, 1);
    return { width: natW * ratio, height: natH * ratio, cx, cy };
  }

  onMount(async () => {
    if (initialUrl) {
      const existingImg = originEl?.querySelector?.("img");
      if (existingImg?.src && !existingImg.src.startsWith("data:image/svg")) {
        resolvedUrlMap = { ...resolvedUrlMap, [initialUrl]: existingImg.src };
      }
      await ensureResolved(initialUrl);
    }

    const rect = getActiveOriginRect();
    if (rect && initialUrl) {
      hideOriginImageImmediate();
      heroPhase = "entering";
      backdropOpacity = 0;
      uiOpacity = 0;
      heroStyle = "opacity: 0; transition: none;";
      await tick();

      if (mainImgEl && !mainImgEl.complete) {
        await new Promise((res) => {
          const done = () => res();
          mainImgEl.addEventListener("load", done, { once: true });
          mainImgEl.addEventListener("error", done, { once: true });
          setTimeout(done, 90);
        });
      }

      const target = getTargetImageBox();
      const startScaleX = rect.width / Math.max(target.width, 1);
      const startScaleY = rect.height / Math.max(target.height, 1);
      const startScale = Math.max(startScaleX, startScaleY, 0.05);
      const dx = (rect.left + rect.width / 2) - target.cx;
      const dy = (rect.top + rect.height / 2) - target.cy;
      const startRadiusPx = originRadius ? (Math.max(target.width, target.height) * 0.5) : 12;

      heroStyle = `transform: translate3d(calc(-50% + ${dx}px), calc(-50% + ${dy}px), 0) scale(${startScale}); border-radius: ${startRadiusPx}px; opacity: 1; transition: none;`;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          backdropOpacity = 1;
          uiOpacity = 1;
          heroStyle = `transform: translate3d(-50%, -50%, 0) scale(1); border-radius: 0px; opacity: 1; transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 320ms cubic-bezier(0.22, 1, 0.36, 1);`;
          setTimeout(() => {
            if (heroPhase === "entering") {
              heroPhase = "idle";
              heroStyle = "";
            }
          }, 330);
        });
      });
    }

    if (userId) {
      loadMorePhotos(0);
    }
  });

  export function requestClose() {
    if (isClosing) return;
    isClosing = true;
    stopAnim();
    stopSlideAnim();

    const rect = currentIndex === 0 ? getActiveOriginRect() : null;
    if (rect && currentUrl) {
      heroPhase = "leaving";
      const core = getOriginCoreEl();
      if (core && core.style) {
        core.style.transition = "none";
        core.style.opacity = "0";
      }
      const target = getTargetImageBox();
      const endScale = Math.max(rect.width / Math.max(target.width, 1), rect.height / Math.max(target.height, 1), 0.05);
      const dx = (rect.left + rect.width / 2) - target.cx;
      const dy = (rect.top + rect.height / 2) - target.cy;
      const endRadiusPx = originRadius ? (Math.max(target.width, target.height) * 0.5) : 12;

      heroStyle = `transform: translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${scale}); border-radius: 0px; transition: none;`;
      fadeInOriginBadges(130);
      requestAnimationFrame(() => {
        backdropOpacity = 0;
        uiOpacity = 0;
        heroStyle = `transform: translate3d(calc(-50% + ${dx}px), calc(-50% + ${dy}px), 0) scale(${endScale}); border-radius: ${endRadiusPx}px; transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 280ms cubic-bezier(0.22, 1, 0.36, 1);`;
        setTimeout(() => {
          if (core && core.style) {
            core.style.transition = "";
            core.style.opacity = "";
          }
          dispatch("close");
        }, 280);
      });
    } else {
      heroPhase = "fading";
      restoreOriginEl(true);
      backdropOpacity = 0;
      uiOpacity = 0;
      heroStyle = `transform: translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${scale}); opacity: 0; border-radius: 0px; transition: opacity 210ms ease-out;`;
      setTimeout(() => {
        dispatch("close");
      }, 215);
    }
  }

  async function ensureResolved(rawUrl) {
    if (!rawUrl) return null;
    if (resolvedUrlMap[rawUrl]) return resolvedUrlMap[rawUrl];
    try {
      const res = await getAssetUrl(rawUrl);
      if (res) {
        resolvedUrlMap = { ...resolvedUrlMap, [rawUrl]: res };
        return res;
      }
    } catch {}
    return null;
  }

  $: {
    const cur = items[currentIndex]?.url;
    const prev = items[currentIndex - 1]?.url;
    const next = items[currentIndex + 1]?.url;
    if (cur) ensureResolved(cur);
    if (prev) ensureResolved(prev);
    if (next) ensureResolved(next);
  }

  $: currentItem = items[currentIndex] || null;
  $: currentUrl = currentItem?.url || null;
  $: prevUrl = currentIndex > 0 ? items[currentIndex - 1]?.url : null;
  $: nextUrl = currentIndex < items.length - 1 ? items[currentIndex + 1]?.url : null;
  $: displayTotal = Math.max(totalCount, items.length);

  $: currentPhotoId = (() => {
    if (!currentItem) return null;
    if (currentItem.photoId) return currentItem.photoId;
    const parsed = parsePhotoIdFromUrl(currentItem.url);
    if (parsed) return parsed;
    if (currentIndex === 0 && isOwnProfile) {
      return $currentUserDetails?.photoId || initialPhotoId || null;
    }
    return null;
  })();

  $: canDeleteActiveSlide = Boolean(isOwnProfile && (currentPhotoId || (currentIndex === 0 && currentUrl)));

  $: if (currentIndex !== undefined) {
    if (userId && !historyEndReached && !isLoadingHistory && currentIndex >= items.length - 3) {
      loadMorePhotos(items.length);
    }
  }

  async function loadMorePhotos(fromOffset) {
    if (!userId || isLoadingHistory || historyEndReached) return;
    isLoadingHistory = true;
    try {
      const res = await $API.fetchUserPhotos(userId, fromOffset, 50);
      const fetchedItems = res?.items || (res?.urls || []).map(u => ({ url: u, photoId: parsePhotoIdFromUrl(u) }));
      if (res?.total != null && res.total > totalCount) {
        totalCount = res.total;
      }
      if (!fetchedItems.length) {
        historyEndReached = true;
        return;
      }
      const next = [...items];
      let added = 0;
      for (const entry of fetchedItems) {
        if (!entry?.url) continue;
        const existingIdx = next.findIndex(x => x.url === entry.url);
        if (existingIdx === -1) {
          next.push({
            url: entry.url,
            photoId: entry.photoId || parsePhotoIdFromUrl(entry.url) || null,
          });
          ensureResolved(entry.url);
          added++;
        } else if (!next[existingIdx].photoId && entry.photoId) {
          next[existingIdx] = { ...next[existingIdx], photoId: entry.photoId };
        }
      }
      items = next;
      if (totalCount < items.length) {
        totalCount = items.length;
      }
      if (fetchedItems.length < 50 || (added === 0 && fromOffset > 0)) {
        historyEndReached = true;
      }
    } catch (e) {
      historyEndReached = true;
    } finally {
      isLoadingHistory = false;
    }
  }

  async function handleUploadClick() {
    if (isUploading) return;
    isUploading = true;
    try {
      if (typeof onUpload === "function") {
        const res = await onUpload();
        const newUrl = res?.baseRawUrl || res?.baseUrl || res?.avatar || res?.baseRawIconUrl || res?.baseIconUrl || res?.iconUrl;
        const newPid = res?.photoId || parsePhotoIdFromUrl(newUrl) || null;
        if (newUrl) {
          ensureResolved(newUrl);
          items = [{ url: newUrl, photoId: newPid }, ...items.filter(x => x.url !== newUrl)];
          totalCount = Math.max(totalCount + 1, items.length);
          currentIndex = 0;
        }
      } else {
        dispatch("upload");
      }
    } finally {
      isUploading = false;
    }
  }

  async function handleDeleteClick() {
    if (!canDeleteActiveSlide || isDeleting) return;
    isDeleting = true;
    const removingIdx = currentIndex;
    const targetPid = currentPhotoId;
    const targetUrl = currentUrl;
    try {
      let updatedContact = null;
      if (typeof onDelete === "function") {
        updatedContact = await onDelete(targetPid, targetUrl);
      } else {
        updatedContact = await $API.deleteProfilePhoto(targetPid, targetUrl);
        dispatch("delete", { photoId: targetPid, url: targetUrl });
      }
      const nextItems = items.filter((_, i) => i !== removingIdx);
      totalCount = Math.max(0, totalCount - 1);
      if (nextItems.length === 0) {
        const fallbackUrl = updatedContact?.baseRawUrl || updatedContact?.baseUrl || updatedContact?.avatar;
        if (fallbackUrl && fallbackUrl !== targetUrl) {
          ensureResolved(fallbackUrl);
          items = [{ url: fallbackUrl, photoId: updatedContact?.photoId || parsePhotoIdFromUrl(fallbackUrl) }];
          currentIndex = 0;
        } else {
          items = [];
          requestClose();
        }
      } else {
        items = nextItems;
        if (currentIndex >= items.length) {
          currentIndex = items.length - 1;
        }
      }
    } catch (e) {
      if (typeof onError === "function") {
        onError(e?.message || "Не удалось удалить фото");
      }
      dispatch("error", { message: e?.message || "Не удалось удалить фото" });
    } finally {
      isDeleting = false;
    }
  }

  async function downloadCurrent() {
    if (!currentUrl || isDownloading) return;
    isDownloading = true;
    try {
      const defaultName = `avatar_${userId || "chat"}_${Date.now()}.jpg`;
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
      });
      if (filePath) {
        await tauriInvoke("download_to_path", {
          url: currentUrl,
          path: filePath,
          onProgress: new Channel(),
        });
        if (typeof onDownloaded === "function") onDownloaded(filePath);
        dispatch("downloaded", { path: filePath });
      }
    } catch (e) {
      if (typeof onError === "function") onError("Не удалось сохранить фото");
      dispatch("error", { message: "Не удалось сохранить фото" });
    } finally {
      isDownloading = false;
    }
  }

  function stopSlideAnim() {
    if (slideAnimFrame) {
      cancelAnimationFrame(slideAnimFrame);
      slideAnimFrame = null;
    }
    isSlideAnimating = false;
  }

  function animateSlideTransition(direction, fromOffset = 0) {
    if (isSlideAnimating) return;
    const nextIdx = currentIndex + direction;
    if (nextIdx < 0 || nextIdx >= items.length) {
      animateSlideSnapBack(fromOffset);
      return;
    }

    stopSlideAnim();
    stopAnim();
    scale = 1;
    x = 0;
    y = 0;

    const width = stageEl?.clientWidth || window.innerWidth;
    const targetOffset = -direction * width;
    const startOffset = fromOffset;
    const duration = 260;
    const startTime = performance.now();
    isSlideAnimating = true;

    function step(now) {
      const p = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      slideOffset = startOffset + (targetOffset - startOffset) * ease;
      if (p < 1) {
        slideAnimFrame = requestAnimationFrame(step);
      } else {
        currentIndex = nextIdx;
        slideOffset = 0;
        isSlideAnimating = false;
        slideAnimFrame = null;
      }
    }

    slideAnimFrame = requestAnimationFrame(step);
  }

  function animateSlideSnapBack(fromOffset) {
    stopSlideAnim();
    const startOffset = fromOffset;
    const duration = 220;
    const startTime = performance.now();
    isSlideAnimating = true;

    function step(now) {
      const p = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      slideOffset = startOffset * (1 - ease);
      if (p < 1) {
        slideAnimFrame = requestAnimationFrame(step);
      } else {
        slideOffset = 0;
        isSlideAnimating = false;
        slideAnimFrame = null;
      }
    }

    slideAnimFrame = requestAnimationFrame(step);
  }

  function prevSlide() {
    if (currentIndex > 0 && !isSlideAnimating) {
      animateSlideTransition(-1, 0);
    }
  }

  function nextSlide() {
    if (currentIndex < items.length - 1 && !isSlideAnimating) {
      animateSlideTransition(1, 0);
    }
  }

  function goToSlide(targetIdx) {
    if (targetIdx === currentIndex || isSlideAnimating || targetIdx < 0 || targetIdx >= items.length) return;
    if (Math.abs(targetIdx - currentIndex) === 1) {
      animateSlideTransition(targetIdx > currentIndex ? 1 : -1, 0);
    } else {
      scale = 1;
      x = 0;
      y = 0;
      slideOffset = 0;
      currentIndex = targetIdx;
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") requestClose();
    if (e.key === "ArrowLeft") prevSlide();
    if (e.key === "ArrowRight") nextSlide();
  }

  function stopAnim() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function animateTo(targetX, targetY, targetScale = scale) {
    stopAnim();
    const startX = x;
    const startY = y;
    const startScale = scale;
    const duration = 220;
    const start = performance.now();

    function frame(t) {
      const p = Math.min((t - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      x = startX + (targetX - startX) * ease;
      y = startY + (targetY - startY) * ease;
      scale = startScale + (targetScale - startScale) * ease;
      if (p < 1) {
        animFrameId = requestAnimationFrame(frame);
      } else {
        animFrameId = null;
      }
    }

    animFrameId = requestAnimationFrame(frame);
  }

  function animateBack() {
    if (!stageEl) {
      animateTo(0, 0, scale);
      return;
    }
    const contentWidth = stageEl.offsetWidth * scale;
    const contentHeight = stageEl.offsetHeight * scale;
    const maxX = Math.max((contentWidth - window.innerWidth) / 2, 0);
    const maxY = Math.max((contentHeight - window.innerHeight) / 2, 0);
    const targetX = scale <= 1 ? 0 : Math.max(-maxX, Math.min(x, maxX));
    const targetY = scale <= 1 ? 0 : Math.max(-maxY, Math.min(y, maxY));
    animateTo(targetX, targetY, scale);
  }

  function getPointerPair() {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    return { dist, midX, midY };
  }

  function handleWheel(e) {
    e.preventDefault();
    if (heroPhase !== "idle") return;
    const delta = -e.deltaY * 0.0015;
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
    if (scale === 1) {
      animateTo(0, 0, 1);
    }
  }

  function handlePointerDown(e) {
    if (heroPhase !== "idle" || isSlideAnimating) return;
    if (e.target.closest(".ag-header") || e.target.closest(".ag-nav-btn") || e.target.closest(".ag-dots-bar")) {
      return;
    }
    stopAnim();
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      isDragging = true;
      dragAxis = null;
      wasGestureMoved = false;
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
      dragStartX = e.clientX - x;
      dragStartY = e.clientY - y;
    } else if (activePointers.size === 2) {
      wasGestureMoved = true;
      dragAxis = null;
      slideOffset = 0;
      const pair = getPointerPair();
      if (pair) {
        pinchStartDist = Math.max(pair.dist, 1);
        pinchStartScale = scale;
        pinchStartMidX = pair.midX;
        pinchStartMidY = pair.midY;
        pinchOriginX = x;
        pinchOriginY = y;
      }
    }
  }

  function handlePointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      const pair = getPointerPair();
      if (!pair) return;
      const ratio = pair.dist / pinchStartDist;
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale * ratio));
      x = pinchOriginX + (pair.midX - pinchStartMidX);
      y = pinchOriginY + (pair.midY - pinchStartMidY);
      return;
    }

    if (!isDragging || activePointers.size !== 1) return;

    const dx = e.clientX - pointerDownX;
    const dy = e.clientY - pointerDownY;
    const movedDist = Math.hypot(dx, dy);

    if (movedDist > 6) {
      wasGestureMoved = true;
      if (!dragAxis && scale <= 1.02) {
        dragAxis = Math.abs(dx) > Math.abs(dy) * 1.1 ? "x" : "y";
      }
    }

    if (scale <= 1.02 && dragAxis === "x" && items.length > 1) {
      const atEdge = (dx > 0 && currentIndex === 0) || (dx < 0 && currentIndex >= items.length - 1);
      slideOffset = atEdge ? dx * 0.32 : dx;
      x = 0;
      y = 0;
      return;
    }

    if (scale <= 1.02 && dragAxis === "y") {
      x = dx * 0.35;
      y = dy;
      const progress = Math.min(Math.abs(y) / (window.innerHeight * 0.45), 1);
      backdropOpacity = Math.max(0.2, 1 - progress * 0.75);
      return;
    }

    x = e.clientX - dragStartX;
    y = e.clientY - dragStartY;
  }

  function handlePointerUp(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);

    if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      dragStartX = remaining.x - x;
      dragStartY = remaining.y - y;
      return;
    }

    if (activePointers.size === 0) {
      isDragging = false;

      if (!wasGestureMoved) {
        const now = Date.now();
        const tapDist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
        if (now - lastTapTime < 300 && tapDist < 40) {
          if (scale > 1.05) {
            animateTo(0, 0, 1);
          } else {
            animateTo(0, 0, 2.5);
          }
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
        return;
      }

      if (scale <= 1.02 && dragAxis === "x" && items.length > 1) {
        const threshold = Math.min((stageEl?.clientWidth || window.innerWidth) * 0.18, 95);
        if (slideOffset < -threshold && currentIndex < items.length - 1) {
          animateSlideTransition(1, slideOffset);
        } else if (slideOffset > threshold && currentIndex > 0) {
          animateSlideTransition(-1, slideOffset);
        } else {
          animateSlideSnapBack(slideOffset);
        }
        dragAxis = null;
        return;
      }

      const absY = Math.abs(y);
      const absX = Math.abs(x);

      if (scale <= 1.02) {
        const dismissY = window.innerHeight * 0.16;
        const dismissX = window.innerWidth * 0.32;
        if (absY > dismissY || (absX > dismissX && items.length <= 1)) {
          requestClose();
        } else {
          backdropOpacity = 1;
          animateTo(0, 0, 1);
        }
        dragAxis = null;
        return;
      }

      dragAxis = null;
      animateBack();
    }
  }

  $: mainTransformStyle = heroPhase !== "idle" && heroStyle
    ? heroStyle
    : `transform: translate3d(calc(-50% + ${x + slideOffset}px), calc(-50% + ${y}px), 0) scale(${scale}); border-radius: 0px;`;
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  class="ag-overlay"
  style="background: rgba(0, 0, 0, {0.96 * backdropOpacity});"
  on:click|self={requestClose}
>
  <div class="ag-header" style="opacity: {uiOpacity};">
    <div class="ag-counter">
      {#if displayTotal > 0}
        {currentIndex + 1} из {displayTotal}
      {/if}
    </div>

    <div class="ag-actions">
      {#if canUpload}
        <button
          type="button"
          class="ag-icon-btn"
          title="Загрузить новое фото"
          disabled={isUploading}
          on:click|stopPropagation={handleUploadClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      {/if}

      {#if canDeleteActiveSlide}
        <button
          type="button"
          class="ag-icon-btn danger"
          title="Удалить это фото"
          disabled={isDeleting}
          on:click|stopPropagation={handleDeleteClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      {/if}

      {#if currentUrl}
        <button
          type="button"
          class="ag-icon-btn"
          title="Скачать фото"
          disabled={isDownloading}
          on:click|stopPropagation={downloadCurrent}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
        </button>
      {/if}

      <button
        type="button"
        class="ag-icon-btn"
        title="Закрыть"
        on:click|stopPropagation={requestClose}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
    </div>
  </div>

  {#if items.length > 1}
    <div class="ag-dots-bar" style="opacity: {uiOpacity};">
      {#each items.slice(0, 24) as _, idx}
        <button
          type="button"
          class="ag-dot"
          class:active={idx === currentIndex}
          on:click|stopPropagation={() => goToSlide(idx)}
          aria-label="Фото {idx + 1}"
        ></button>
      {/each}
    </div>
  {/if}

  <div class="ag-body">
    <button
      type="button"
      class="ag-nav-btn prev"
      class:hidden={currentIndex === 0 || uiOpacity < 0.5}
      on:click|stopPropagation={prevSlide}
      aria-label="Предыдущее фото"
    >
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
      </svg>
    </button>

    <div
      bind:this={stageEl}
      class="ag-stage"
      on:wheel|nonpassive={handleWheel}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={handlePointerUp}
    >
      {#if prevUrl && (slideOffset > 0 || isSlideAnimating) && heroPhase === "idle"}
        {#if resolvedUrlMap[prevUrl]}
          <img
            src={resolvedUrlMap[prevUrl]}
            alt=""
            draggable="false"
            class="ag-image"
            style="transform: translate3d(calc(-50% + {slideOffset - (stageEl?.clientWidth || window.innerWidth)}px), -50%, 0) scale(1); border-radius: 0px;"
          />
        {/if}
      {/if}

      {#if currentUrl}
        {#if resolvedUrlMap[currentUrl]}
          <img
            bind:this={mainImgEl}
            src={resolvedUrlMap[currentUrl]}
            alt=""
            draggable="false"
            class="ag-image"
            style={mainTransformStyle}
          />
        {:else}
          <div class="ag-shimmer"></div>
        {/if}
      {:else if isLoadingHistory}
        <div class="ag-shimmer"></div>
      {/if}

      {#if nextUrl && (slideOffset < 0 || isSlideAnimating) && heroPhase === "idle"}
        {#if resolvedUrlMap[nextUrl]}
          <img
            src={resolvedUrlMap[nextUrl]}
            alt=""
            draggable="false"
            class="ag-image"
            style="transform: translate3d(calc(-50% + {slideOffset + (stageEl?.clientWidth || window.innerWidth)}px), -50%, 0) scale(1); border-radius: 0px;"
          />
        {/if}
      {/if}
    </div>

    <button
      type="button"
      class="ag-nav-btn next"
      class:hidden={currentIndex >= items.length - 1 || uiOpacity < 0.5}
      on:click|stopPropagation={nextSlide}
      aria-label="Следующее фото"
    >
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
      </svg>
    </button>
  </div>
</div>

<style>
  .ag-overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    z-index: 20000;
    display: flex;
    flex-direction: column;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    overscroll-behavior: none;
    transition: background 180ms ease-out;
  }

  .ag-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: calc(12px + env(safe-area-inset-top, 0px)) 18px 12px;
    color: #ffffff;
    z-index: 20;
    transition: opacity 180ms ease-out;
  }

  .ag-counter {
    font-size: 15px;
    font-weight: 600;
    opacity: 0.9;
  }

  .ag-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ag-icon-btn {
    width: 38px;
    height: 38px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, opacity 0.15s, transform 0.12s;
  }

  .ag-icon-btn:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .ag-icon-btn:active {
    transform: scale(0.92);
  }

  .ag-icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ag-icon-btn.danger {
    color: #ff595a;
    background: rgba(255, 89, 90, 0.14);
  }

  .ag-icon-btn.danger:hover {
    background: rgba(255, 89, 90, 0.25);
  }

  .ag-icon-btn svg {
    width: 22px;
    height: 22px;
  }

  .ag-dots-bar {
    display: flex;
    gap: 4px;
    padding: 0 18px 8px;
    z-index: 20;
    transition: opacity 180ms ease-out;
  }

  .ag-dot {
    flex: 1;
    height: 3px;
    border: none;
    padding: 0;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.28);
    cursor: pointer;
    transition: background 0.15s;
  }

  .ag-dot.active {
    background: #ffffff;
  }

  .ag-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    overflow: visible;
    touch-action: none;
    padding: 0 10px calc(24px + env(safe-area-inset-bottom, 0px));
  }

  .ag-stage {
    flex: 1;
    height: 100%;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
  }

  .ag-image {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate3d(-50%, -50%, 0) scale(1);
    max-width: 94vw;
    max-height: 80vh;
    object-fit: cover;
    will-change: transform, border-radius, opacity;
    touch-action: none;
    -webkit-user-drag: none;
    user-select: none;
  }

  .ag-shimmer {
    width: min(80vw, 420px);
    height: min(80vw, 420px);
    border-radius: 16px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: agShimmer 1.5s infinite linear;
  }

  @keyframes agShimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .ag-nav-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    border: none;
    color: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 30;
    transition: background 0.15s, opacity 0.18s;
    flex-shrink: 0;
  }

  .ag-nav-btn:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .ag-nav-btn.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .ag-nav-btn svg {
    width: 30px;
    height: 30px;
  }

  @media (max-width: 768px) {
    .ag-nav-btn {
      position: absolute;
      width: 40px;
      height: 40px;
      background: rgba(0, 0, 0, 0.38);
      top: 50%;
      transform: translateY(-50%);
    }

    .ag-nav-btn.prev {
      left: 10px;
    }

    .ag-nav-btn.next {
      right: 10px;
    }
  }
</style>
