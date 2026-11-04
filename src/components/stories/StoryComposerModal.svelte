<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { fade, fly, slide } from "svelte/transition";
  import { invoke } from "@tauri-apps/api/core";
  import API, { currentUser } from "$lib/stores/api";
  import {
    addStoryLocally,
    refreshStoriesFeed,
    storyComposerState,
    closeStoryComposer
  } from "$lib/stores/stories";
  import { getProxiedMediaUrl } from "$lib/utils/images";
  import { cropVideoToMp4 } from "$lib/utils/videoEncoder";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { Mp4Encoder, isWebCodecsMp4Available } from "$lib/utils/mp4Encoder";
  import StoryCropOverlay from "./StoryCropOverlay.svelte";
  import {
    createGifDecoder,
    renderGifToVideoBlob,
    renderPhotoToVideoBlob
  } from "$lib/utils/storyMediaConverter";
  import StoryTrimmer from "./StoryTrimmer.svelte";
  import StoryComposerHeader from "./StoryComposerHeader.svelte";
  import StoryDrawer from "./StoryDrawer.svelte";
  import StoryOverlayItem from "./StoryOverlayItem.svelte";
  import StoryDoodleCanvas from "./StoryDoodleCanvas.svelte";
  import ColorPicker from "$components/ChatWindow/input/ColorPicker.svelte";
  import StickerPanel from "$components/ChatWindow/Stickers/StickerPanel.svelte";
  import { getAvailableFonts } from "$lib/utils/fontDetector";
  import { showAlert } from "$lib/utils/alert";
  import { extractMediaSource } from "$lib/utils/mediaUtils";
  import {
    STORY_FILTERS,
    applyFilterToImageData,
    renderStoryLayersToCanvas
  } from "$lib/utils/storyCompositor";

  export let isOpen = false;

  const dispatch = createEventDispatcher();

  let mode = "camera";
  let cameraStream = null;
  let videoPreviewEl = null;
  let videoMainEl = null;
  let facingMode = "user";

  let isRecording = false;
  let mediaRecorder = null;
  let mp4Encoder = null;
  let recordedChunks = [];
  let recordStartTime = 0;
  let recordTimerId = null;
  let recordDurationSec = 0;
  const MAX_RECORD_SEC = 60;

  let cropRect = { x: 0, y: 0, w: 1, h: 1 };
  let unregModalBack = null;
  let unregEditBack = null;
  let unregDrawerBack = null;
  let unregLayerBack = null;

  function formatRecordTimer(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  let capturedMedia = null;
  let mediaType = null;
  let mediaUrl = null;
  let mediaFile = null;
  let mediaNaturalWidth = 0;
  let mediaNaturalHeight = 0;
  let mediaPanX = 0;
  let mediaPanY = 0;
  let mediaZoom = 1.0;
  let isPanningMedia = false;
  let mediaPanStartX = 0;
  let mediaPanStartY = 0;
  let initialMediaPanX = 0;
  let initialMediaPanY = 0;

  let trimStart = 0;
  let trimEnd = 15;
  let videoDuration = 0;
  let videoCurrentTime = 0;
  let isGif = false;
  let isVideoSeeking = false;
  let isAudioMuted = false;
  let gifDecoder = null;
  let gifPreviewCanvas = null;
  let fallbackFileInput = null;
  let lastGifTick = 0;
  let animFrameId = null;

  let layers = [];
  let selectedLayerId = null;
  let nextLayerId = 1;
  let editingLayerId = null;

  let overlayHistory = [[]];
  let overlayHistoryIndex = 0;
  $: canUndoOverlay = overlayHistoryIndex > 0;
  $: canRedoOverlay = overlayHistoryIndex < overlayHistory.length - 1;

  let linkInputUrl = "";

  let selectedTextColor = "#ffffff";
  let selectedTextBg = "rgba(0,0,0,0.7)";
  let selectedFontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  let availableFonts = [];
  let fontDropdownOpen = false;

  let activeDrawer = "none";
  let cropAspectMode = "original";

  const CROP_ASPECTS = [
    { id: "original", label: "Оригинал" },
    { id: "1:1", label: "1:1" },
    { id: "4:5", label: "4:5" },
    { id: "16:9", label: "16:9" },
    { id: "9:16", label: "9:16" }
  ];

  const TEXT_BG_OPTIONS = [
    { id: "transparent", label: "Без фона", value: "transparent" },
    { id: "dark", label: "Темный", value: "rgba(0, 0, 0, 0.75)" },
    { id: "light", label: "Светлый", value: "rgba(255, 255, 255, 0.9)" }
  ];

  const PRESET_COLORS = [
    "#ffffff",
    "#000000",
    "#ef4444",
    "#f59e0b",
    "#10b981",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899"
  ];

  let doodleCanvas;
  let doodleColor = "#ff4444";
  let doodleSize = 6;
  let canUndoDoodle = false;
  let canRedoDoodle = false;
  let isColorPickerOpen = false;
  let colorPickerTarget = "doodle";

  let isPhotoToVideo = false;
  let photoVideoDuration = 5;
  let audioTrackFile = null;
  let audioTrackName = "";

  let selectedFilter = "none";
  let filterThumbnailUrl = "";
  const FILTERS = STORY_FILTERS;

  let storyPreviewWrapperEl;
  let previewWidth = 360;
  let previewHeight = 640;
  let resizeObserver = null;

  let audience = 1;
  let isPublishing = false;
  let statusMessage = "";

  let cropOverlayRef = null;
  let currentCropDraft = { x: 0, y: 0, w: 1, h: 1 };
  let isCropModified = false;
  let dismissedOverlayOnPointerDown = false;

  $: composerState = $storyComposerState;
  $: isAttachmentMode = !!composerState?.onSave;
  $: mediaAspect = mediaNaturalWidth && mediaNaturalHeight ? mediaNaturalWidth / mediaNaturalHeight : 9 / 16;
  $: targetAspect = !isAttachmentMode
    ? 9 / 16
    : (cropRect.w && cropRect.h && (cropRect.w < 0.999 || cropRect.h < 0.999)
      ? (mediaAspect * (cropRect.w / cropRect.h))
      : mediaAspect);
  $: isNon916 = !isAttachmentMode && Math.abs(mediaAspect - 9 / 16) > 0.03;

  $: isCropApplied = (cropRect.w < 0.999 || cropRect.h < 0.999 || cropRect.x > 0.001 || cropRect.y > 0.001);
  $: mediaClipStyle = (isCropApplied && activeDrawer !== "crop")
    ? `clip-path: inset(${cropRect.y * 100}% ${(1 - cropRect.x - cropRect.w) * 100}% ${(1 - cropRect.y - cropRect.h) * 100}% ${cropRect.x * 100}%);`
    : "";

  $: imgBounds = (() => {
    const cW = previewWidth || 360;
    const cH = previewHeight || 640;
    const cAspect = cW / (cH || 1);
    const nW = mediaNaturalWidth || 1080;
    const nH = mediaNaturalHeight || 1920;
    const mAspect = nW / (nH || 1);

    if (isAttachmentMode) {
      return { x: 0, y: 0, w: cW, h: cH };
    }

    let w = cW;
    let h = cH;
    let x = 0;
    let y = 0;

    if (mAspect > cAspect) {
      w = cW;
      h = cW / mAspect;
      y = (cH - h) / 2;
    } else {
      h = cH;
      w = cH * mAspect;
      x = (cW - w) / 2;
    }
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  })();

  $: isDrawingMode = activeDrawer === "drawing";
  $: isFilterDrawerOpen = activeDrawer === "filters";
  $: isStickerPickerOpen = activeDrawer === "stickers";
  $: linkModalOpen = activeDrawer === "link";
  $: hasTrimmer = (mediaType === "video" || isGif || isPhotoToVideo);

  $: if (isOpen && !unregModalBack) {
    unregModalBack = registerBackHandler(() => {
      handleClose();
    });
  } else if (!isOpen && unregModalBack) {
    unregModalBack();
    unregModalBack = null;
  }

  $: if (isOpen && mode === "edit" && !unregEditBack) {
    unregEditBack = registerBackHandler(() => {
      if (composerState?.file || composerState?.attach || isAttachmentMode) {
        handleClose();
      } else {
        mode = "camera";
        startCamera();
      }
    });
  } else if ((!isOpen || mode !== "edit") && unregEditBack) {
    unregEditBack();
    unregEditBack = null;
  }

  $: if (isOpen && activeDrawer !== "none" && !unregDrawerBack) {
    unregDrawerBack = registerBackHandler(() => {
      currentCropDraft = { ...cropRect };
      activeDrawer = "none";
    });
  } else if ((!isOpen || activeDrawer === "none") && unregDrawerBack) {
    unregDrawerBack();
    unregDrawerBack = null;
  }

  $: if (isOpen && selectedLayerId && !unregLayerBack) {
    unregLayerBack = registerBackHandler(() => {
      selectedLayerId = null;
    });
  } else if ((!isOpen || !selectedLayerId) && unregLayerBack) {
    unregLayerBack();
    unregLayerBack = null;
  }

  $: if (isOpen && composerState?.isOpen && (composerState.file || composerState.attach)) {
    loadExternalMedia(composerState.file, composerState.attach);
  }

  $: if (isOpen && mode === "camera") {
    startCamera();
  }

  onMount(async () => {
    try {
      availableFonts = await getAvailableFonts();
      if (availableFonts.length > 0) {
        selectedFontFamily = availableFonts[0].family;
      }
    } catch {}

    if (storyPreviewWrapperEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          if (cr.width > 0 && cr.height > 0) {
            previewWidth = Math.round(cr.width);
            previewHeight = Math.round(cr.height);
          }
        }
      });
      resizeObserver.observe(storyPreviewWrapperEl);
    }
  });

  onDestroy(() => {
    stopCamera();
    stopVideoRecording();
    stopPlaybackLoop();
    if (unregLayerBack) {
      unregLayerBack();
      unregLayerBack = null;
    }
    if (unregDrawerBack) {
      unregDrawerBack();
      unregDrawerBack = null;
    }
    if (unregEditBack) {
      unregEditBack();
      unregEditBack = null;
    }
    if (unregModalBack) {
      unregModalBack();
      unregModalBack = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  function observeCanvasSize(node) {
    storyPreviewWrapperEl = node;
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      previewWidth = Math.round(rect.width);
      previewHeight = Math.round(rect.height);
    }
    if (typeof ResizeObserver !== "undefined") {
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          if (cr.width > 0 && cr.height > 0) {
            previewWidth = Math.round(cr.width);
            previewHeight = Math.round(cr.height);
          }
        }
      });
      resizeObserver.observe(node);
    }
    return {
      destroy() {
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }
      }
    };
  }

  async function loadMediaSource(source) {
    if (!source) return;
    stopCamera();
    stopVideoRecording();

    const target = source?.attach || source;
    const file = target instanceof Blob ? target : (target?.file || target?.blob || null);
    const meta = extractMediaSource(file || target);
    if (!meta) return;

    isGif = meta.isGif;
    mediaType = meta.mediaType;
    mediaFile = file;

    const path = target?.path || (typeof source === "string" ? source : meta.path);
    capturedMedia = {
      blob: file,
      path: path && !path.startsWith("blob:") ? path : undefined,
      name: meta.name || (meta.isVideo ? (meta.isGif ? "media.gif" : "media.mp4") : "media.jpg"),
      isVideo: meta.isVideo,
      isGif: meta.isGif
    };

    if (file) {
      mediaUrl = URL.createObjectURL(file);
    } else if (path) {
      mediaUrl = getProxiedMediaUrl(path);
    } else if (target?.url || target?.baseUrl) {
      mediaUrl = target.url || target.baseUrl;
    }

    if (meta.isGif) {
      try {
        const buf = file
          ? await file.arrayBuffer()
          : await (await fetch(getProxiedMediaUrl(mediaUrl))).arrayBuffer();
        await initGifDecoder(buf);
      } catch (err) {
        console.warn("Failed to decode GIF:", err);
      }
    } else if (meta.isVideo) {
      if (target?.duration && !isNaN(target.duration) && isFinite(target.duration) && target.duration > 0) {
        videoDuration = Number(target.duration);
        trimStart = 0;
        trimEnd = Math.min(videoDuration, 60);
      } else {
        videoDuration = 0;
        trimStart = 0;
        trimEnd = 0;
      }
      videoCurrentTime = 0;
    }

    cropRect = { x: 0, y: 0, w: 1, h: 1 };
    currentCropDraft = { ...cropRect };
    isCropModified = false;

    resetFraming();
    mode = "edit";
  }

  async function loadExternalMedia(file, attach) {
    await loadMediaSource(attach || file);
  }

  async function startCamera() {
    stopCamera();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: true
      });
      if (videoPreviewEl) {
        videoPreviewEl.srcObject = cameraStream;
      }
    } catch (err) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        if (videoPreviewEl) {
          videoPreviewEl.srcObject = cameraStream;
        }
      } catch (_) {}
    }
  }

  let cameraFreezeSnapshotUrl = "";
  let isProcessingRecord = false;

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    if (videoPreviewEl) {
      videoPreviewEl.srcObject = null;
    }
  }

  function toggleCamera() {
    if (videoPreviewEl && videoPreviewEl.videoWidth > 0) {
      try {
        const freezeCanvas = document.createElement("canvas");
        freezeCanvas.width = videoPreviewEl.videoWidth;
        freezeCanvas.height = videoPreviewEl.videoHeight;
        const freezeCtx = freezeCanvas.getContext("2d");
        freezeCtx.drawImage(videoPreviewEl, 0, 0);
        cameraFreezeSnapshotUrl = freezeCanvas.toDataURL("image/jpeg", 0.7);
      } catch (_) {}
    }
    facingMode = facingMode === "user" ? "environment" : "user";
    startCamera();
  }

  async function handleCapturePhoto() {
    if (!videoPreviewEl) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoPreviewEl.videoWidth || 1080;
    canvas.height = videoPreviewEl.videoHeight || 1920;
    const ctx = canvas.getContext("2d");

    if (selectedFilter !== "none") {
      const f = FILTERS.find((x) => x.id === selectedFilter);
      if (f && f.css !== "none") ctx.filter = f.css;
    }

    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(videoPreviewEl, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      stopCamera();
      capturedMedia = {
        blob,
        name: `photo_${Date.now()}.jpg`,
        isVideo: false
      };
      mediaType = "photo";
      mediaUrl = URL.createObjectURL(blob);
      mediaNaturalWidth = canvas.width;
      mediaNaturalHeight = canvas.height;
      resetFraming();
      generateFilterThumbnail();
      mode = "edit";
    }, "image/jpeg", 0.95);
  }

  async function startVideoRecording() {
    if (isRecording || !cameraStream) return;
    isRecording = true;
    recordStartTime = performance.now();
    recordDurationSec = 0;
    recordTimerId = setInterval(() => {
      recordDurationSec = Math.min(
        MAX_RECORD_SEC,
        Math.floor((performance.now() - recordStartTime) / 1000)
      );
      if (recordDurationSec >= MAX_RECORD_SEC) {
        stopVideoRecording();
      }
    }, 250);

    if (isWebCodecsMp4Available()) {
      try {
        mp4Encoder = new Mp4Encoder({
          width: 540,
          height: 960,
          fps: 30,
          mirror: facingMode === "user"
        });
        await mp4Encoder.start(cameraStream);
        return;
      } catch (err) {
        mp4Encoder = null;
      }
    }

    recordedChunks = [];
    let mimeType = "video/mp4;codecs=avc1,mp4a.40.2";
    if (typeof MediaRecorder !== "undefined") {
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/mp4;codecs=avc1";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/mp4";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm;codecs=vp8,opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";
    }
    try {
      mediaRecorder = new MediaRecorder(cameraStream, mimeType ? { mimeType } : {});
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const fullBlob = new Blob(recordedChunks, { type: mimeType || "video/mp4" });
        stopCamera();
        capturedMedia = {
          blob: fullBlob,
          name: `video_${Date.now()}.mp4`,
          isVideo: true
        };
        mediaType = "video";
        mediaUrl = URL.createObjectURL(fullBlob);
        resetFraming();
        mode = "edit";
      };
      mediaRecorder.start();
    } catch (_) {
      isRecording = false;
      if (recordTimerId) {
        clearInterval(recordTimerId);
        recordTimerId = null;
      }
    }
  }

  async function stopVideoRecording() {
    if (!isRecording) return;
    isRecording = false;
    if (recordTimerId) {
      clearInterval(recordTimerId);
      recordTimerId = null;
    }

    isProcessingRecord = true;
    if (mp4Encoder) {
      try {
        const mp4Blob = await mp4Encoder.stop();
        mp4Encoder = null;
        stopCamera();
        capturedMedia = {
          blob: mp4Blob,
          name: `video_${Date.now()}.mp4`,
          isVideo: true
        };
        mediaType = "video";
        mediaUrl = URL.createObjectURL(mp4Blob);
        resetFraming();
        mode = "edit";
      } catch (err) {
        mp4Encoder = null;
      } finally {
        isProcessingRecord = false;
      }
      return;
    }

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    isProcessingRecord = false;
  }

  function initGifDecoder(arrayBuffer) {
    try {
      gifDecoder = createGifDecoder(arrayBuffer);
      mediaNaturalWidth = gifDecoder.width;
      mediaNaturalHeight = gifDecoder.height;
      videoDuration = gifDecoder.duration;
      trimStart = 0;
      trimEnd = gifDecoder.duration;
      videoCurrentTime = 0;
      if (gifPreviewCanvas) {
        gifPreviewCanvas.width = gifDecoder.width;
        gifPreviewCanvas.height = gifDecoder.height;
      }
      renderCurrentGifFrame();
      generateFilterThumbnail();
      startPlaybackLoop();
    } catch (err) {
      console.warn("Failed to decode GIF metadata:", err);
    }
  }

  function renderCurrentGifFrame() {
    if (!gifPreviewCanvas || !gifDecoder) return;
    const frameMeta = gifDecoder.getMatchingFrame(videoCurrentTime);
    if (!frameMeta) return;
    const frameCanvas = gifDecoder.getFrameCanvas(frameMeta.index);
    if (!frameCanvas) return;
    const ctx = gifPreviewCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, gifPreviewCanvas.width, gifPreviewCanvas.height);
    ctx.drawImage(frameCanvas, 0, 0, gifPreviewCanvas.width, gifPreviewCanvas.height);
  }

  async function renderGif(trimStartSec, trimEndSec) {
    if (!gifDecoder) return null;
    return await renderGifToVideoBlob(gifDecoder, layers, {
      trimStartSec,
      trimEndSec,
      previewWidth,
      doodleCanvas,
      targetWidth: composerState?.onSave ? mediaNaturalWidth : 720,
      targetHeight: composerState?.onSave ? mediaNaturalHeight : 1280
    });
  }

  async function handlePickGalleryMedia() {
    try {
      const response = await invoke("pick").catch(() => null);
      if (response && response !== "CANCEL") {
        const { uri, mime_type: mime } = response;
        const filePath = decodeURIComponent(uri);
        await loadMediaSource({ path: filePath, mime });
        return;
      }
    } catch (_) {}
    fallbackFileInput?.click();
  }

  async function processSelectedPath(filePath) {
    await loadMediaSource(filePath);
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (file) {
      await loadMediaSource(file);
    }
  }

  async function handleAudioSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    audioTrackFile = file;
    audioTrackName = file.name;
    isPhotoToVideo = true;
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const ab = await file.slice(0).arrayBuffer();
      const decoded = await actx.decodeAudioData(ab);
      actx.close();
      if (decoded?.duration && Number.isFinite(decoded.duration)) {
        photoVideoDuration = Math.max(1, Math.round(decoded.duration));
      }
    } catch (_) {
      const tempAudio = new Audio();
      tempAudio.src = URL.createObjectURL(file);
      tempAudio.onloadedmetadata = () => {
        if (tempAudio.duration && Number.isFinite(tempAudio.duration)) {
          photoVideoDuration = Math.max(1, Math.round(tempAudio.duration));
        }
        URL.revokeObjectURL(tempAudio.src);
      };
    }
  }

  function removeAudio() {
    audioTrackFile = null;
    audioTrackName = "";
  }

  function handleImageLoad(e) {
    const el = e.currentTarget;
    mediaNaturalWidth = el.naturalWidth || 1080;
    mediaNaturalHeight = el.naturalHeight || 1920;
    generateFilterThumbnail();
  }

  function handleVideoLoadedMetadata(e) {
    const el = e.currentTarget || videoMainEl;
    if (!el) return;
    mediaNaturalWidth = el.videoWidth || 1080;
    mediaNaturalHeight = el.videoHeight || 1920;
    if (el.duration && !isNaN(el.duration) && isFinite(el.duration) && el.duration > 0) {
      videoDuration = el.duration;
      trimStart = 0;
      trimEnd = Math.min(videoDuration, 60);
      videoCurrentTime = 0;
    }
    isVideoPaused = false;
    generateVideoThumbnail();
    el.play().catch(() => {});
    startPlayheadSync();
  }

  let playheadRaf = null;

  function startPlayheadSync() {
    isVideoPaused = false;
    if (playheadRaf) return;
    const step = () => {
      if (videoMainEl && !videoMainEl.paused) {
        videoCurrentTime = videoMainEl.currentTime;
        if (!isVideoSeeking && trimEnd > trimStart && videoCurrentTime >= trimEnd) {
          isVideoSeeking = true;
          videoMainEl.currentTime = trimStart;
          setTimeout(() => {
            isVideoSeeking = false;
          }, 150);
        }
        playheadRaf = requestAnimationFrame(step);
      } else {
        playheadRaf = null;
      }
    };
    playheadRaf = requestAnimationFrame(step);
  }

  function stopPlayheadSync() {
    isVideoPaused = true;
    if (playheadRaf) {
      cancelAnimationFrame(playheadRaf);
      playheadRaf = null;
    }
  }

  function startPlaybackLoop() {
    if (!isGif || animFrameId) return;
    lastGifTick = performance.now();
    function tick(now) {
      if (isGif && gifDecoder) {
        const dt = (now - lastGifTick) / 1000;
        lastGifTick = now;
        videoCurrentTime += dt;
        if (trimEnd > trimStart && videoCurrentTime >= trimEnd) {
          videoCurrentTime = trimStart;
        } else if (videoDuration > 0 && videoCurrentTime >= videoDuration) {
          videoCurrentTime = 0;
        }
        renderCurrentGifFrame();
      }
      animFrameId = requestAnimationFrame(tick);
    }
    animFrameId = requestAnimationFrame(tick);
    isVideoPaused = false;
  }

  function stopPlaybackLoop() {
    stopPlayheadSync();
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function handleVideoCanPlay(e) {
    const el = e.currentTarget || videoMainEl;
    if (!el) return;
    generateVideoThumbnail();
    el.play().catch(() => {});
    startPlayheadSync();
  }

  function handleVideoTimeUpdate(e) {
    const cur = e.currentTarget.currentTime;
    videoCurrentTime = cur;
    if ((!filterThumbnailUrl || filterThumbnailUrl.length < 500) && cur > 0.05) {
      generateVideoThumbnail();
    }
    if (!isVideoSeeking && trimEnd > trimStart && cur >= trimEnd) {
      isVideoSeeking = true;
      e.currentTarget.currentTime = trimStart;
      setTimeout(() => {
        isVideoSeeking = false;
      }, 150);
    }
  }

  function handleVideoEnded() {
    if (videoMainEl) {
      videoMainEl.currentTime = trimStart;
      videoMainEl.play().catch(() => {});
    }
  }

  function handleTrimmerChange(e) {
    trimStart = e.detail.trimStart;
    trimEnd = e.detail.trimEnd;
    if (isGif) {
      videoCurrentTime = trimStart;
      renderCurrentGifFrame();
    }
  }

  function handleTrimmerSeek(e) {
    videoCurrentTime = e.detail.time;
    if (isGif) {
      renderCurrentGifFrame();
    } else if (videoMainEl && !isVideoSeeking) {
      isVideoSeeking = true;
      videoMainEl.currentTime = e.detail.time;
      setTimeout(() => {
        isVideoSeeking = false;
      }, 120);
    }
  }

  function resetFraming() {
    mediaPanX = 0;
    mediaPanY = 0;
    mediaZoom = 1.0;
  }

  let isVideoPaused = false;
  let mediaPointerDownX = 0;
  let mediaPointerDownY = 0;

  function isCanvasBlack(ctx, width, height) {
    try {
      const data = ctx.getImageData(0, 0, Math.min(width, 32), Math.min(height, 32)).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 15 || data[i + 1] > 15 || data[i + 2] > 15) {
          return false;
        }
      }
    } catch {}
    return true;
  }

  function generateVideoThumbnail() {
    if (!videoMainEl || videoMainEl.videoWidth === 0) return;
    try {
      const snapCanvas = document.createElement("canvas");
      snapCanvas.width = 120;
      snapCanvas.height = Math.round(120 * (videoMainEl.videoHeight / videoMainEl.videoWidth));
      const snapCtx = snapCanvas.getContext("2d");
      snapCtx.drawImage(videoMainEl, 0, 0, snapCanvas.width, snapCanvas.height);
      if (isCanvasBlack(snapCtx, snapCanvas.width, snapCanvas.height)) {
        return;
      }
      const url = snapCanvas.toDataURL("image/jpeg", 0.75);
      if (url && url.length > 500) {
        filterThumbnailUrl = url;
      }
    } catch (_) {}
  }

  function generateFilterThumbnail() {
    try {
      if (mediaType === "video" && !isGif) {
        generateVideoThumbnail();
        return;
      }
      const snapCanvas = document.createElement("canvas");
      snapCanvas.width = 72;
      snapCanvas.height = 72;
      const snapCtx = snapCanvas.getContext("2d");
      if (mediaUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = mediaUrl;
        img.onload = () => {
          snapCtx.drawImage(img, 0, 0, 72, 72);
          filterThumbnailUrl = snapCanvas.toDataURL("image/jpeg", 0.7);
        };
      }
    } catch (_) {}
  }

  function toggleMediaPlayback() {
    if (mediaType === "video" && videoMainEl) {
      if (videoMainEl.paused) {
        videoMainEl.play().catch(() => {});
        isVideoPaused = false;
      } else {
        videoMainEl.pause();
        isVideoPaused = true;
      }
    } else if (isGif) {
      if (animFrameId) {
        stopPlaybackLoop();
      } else {
        startPlaybackLoop();
      }
    }
  }

  function handleMediaPointerDown(e) {
    if (isDrawingMode || activeDrawer === "drawing" || activeDrawer === "crop") return;
    if (e.target.closest(".overlay-item-wrapper") || e.target.closest(".interactive-ctrl")) {
      return;
    }
    const hadActiveSelection = Boolean(selectedLayerId || editingLayerId || activeDrawer === "text");
    selectedLayerId = null;
    editingLayerId = null;
    if (activeDrawer === "text") {
      activeDrawer = "none";
    }
    dismissedOverlayOnPointerDown = hadActiveSelection;

    mediaPointerDownX = e.clientX;
    mediaPointerDownY = e.clientY;

    if (isNon916 || mediaZoom > 1.0) {
      isPanningMedia = true;
      mediaPanStartX = e.clientX;
      mediaPanStartY = e.clientY;
      initialMediaPanX = mediaPanX;
      initialMediaPanY = mediaPanY;
      window.addEventListener("pointermove", handleMediaPointerMove);
      window.addEventListener("pointerup", handleMediaPointerUp);
    }
  }

  function handleMediaPointerMove(e) {
    if (!isPanningMedia) return;
    const dx = e.clientX - mediaPanStartX;
    const dy = e.clientY - mediaPanStartY;

    const maxPanX = Math.max(0, ((previewWidth * mediaZoom) - previewWidth) / 2 + (isNon916 ? 120 : 0));
    const maxPanY = Math.max(0, ((previewHeight * mediaZoom) - previewHeight) / 2 + (isNon916 ? 120 : 0));

    mediaPanX = Math.max(-maxPanX, Math.min(maxPanX, initialMediaPanX + dx));
    mediaPanY = Math.max(-maxPanY, Math.min(maxPanY, initialMediaPanY + dy));
  }

  function handleMediaPointerUp() {
    isPanningMedia = false;
    window.removeEventListener("pointermove", handleMediaPointerMove);
    window.removeEventListener("pointerup", handleMediaPointerUp);
  }

  function handleMediaClick(e) {
    if (dismissedOverlayOnPointerDown) {
      dismissedOverlayOnPointerDown = false;
      return;
    }
    if (isDrawingMode || activeDrawer === "drawing" || activeDrawer === "crop") return;
    if (e.target.closest(".overlay-item-wrapper") || e.target.closest(".interactive-ctrl")) {
      return;
    }
    const dx = Math.abs(e.clientX - mediaPointerDownX);
    const dy = Math.abs(e.clientY - mediaPointerDownY);
    if (dx > 8 || dy > 8) return;
    toggleMediaPlayback();
  }

  function handleMediaWheel(e) {
    if (e.target.closest(".overlay-item-wrapper") || e.target.closest(".interactive-ctrl")) {
      return;
    }
    e.preventDefault();
    const delta = e.deltaY * -0.0015;
    mediaZoom = Math.max(0.65, Math.min(3.0, mediaZoom + delta));
  }

  function recordHistorySnapshot() {
    const snap = JSON.parse(JSON.stringify(layers));
    if (overlayHistoryIndex < overlayHistory.length - 1) {
      overlayHistory = overlayHistory.slice(0, overlayHistoryIndex + 1);
    }
    overlayHistory.push(snap);
    overlayHistoryIndex = overlayHistory.length - 1;
  }

  function undoOverlay() {
    if (!canUndoOverlay) return;
    overlayHistoryIndex--;
    layers = JSON.parse(JSON.stringify(overlayHistory[overlayHistoryIndex]));
    selectedLayerId = null;
  }

  function redoOverlay() {
    if (!canRedoOverlay) return;
    overlayHistoryIndex++;
    layers = JSON.parse(JSON.stringify(overlayHistory[overlayHistoryIndex]));
    selectedLayerId = null;
  }

  function addLinkLayer() {
    let url = linkInputUrl.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    if (editingLayerId) {
      layers = layers.map((l) => (l.id === editingLayerId ? { ...l, url } : l));
      editingLayerId = null;
    } else {
      const layer = {
        id: nextLayerId++,
        type: "link",
        x: 0.5,
        y: 0.78,
        scale: 1,
        rotation: 0,
        url
      };
      layers = [...layers, layer];
      selectedLayerId = layer.id;
    }

    linkInputUrl = "";
    activeDrawer = "none";
    recordHistorySnapshot();
  }

  function toggleDrawer(name) {
    if (activeDrawer === name) {
      if (name === "text") finishTextEditing();
      else activeDrawer = "none";
    } else {
      if (activeDrawer === "text") finishTextEditing();
      activeDrawer = name;
      if (name === "text") {
        let activeTextLayer = layers.find((l) => l.id === selectedLayerId && l.type === "text");
        if (!activeTextLayer) {
          const layer = {
            id: nextLayerId++,
            type: "text",
            x: 0.5,
            y: 0.45,
            scale: 1,
            rotation: 0,
            boxWidth: 260,
            text: "Текст",
            color: selectedTextColor,
            bg: selectedTextBg,
            fontFamily: selectedFontFamily
          };
          layers = [...layers, layer];
          selectedLayerId = layer.id;
          editingLayerId = layer.id;
          recordHistorySnapshot();
        } else {
          editingLayerId = activeTextLayer.id;
          selectedTextColor = activeTextLayer.color || "#ffffff";
          selectedTextBg = activeTextLayer.bg || "rgba(0,0,0,0.7)";
          selectedFontFamily = activeTextLayer.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        }
      }
    }
  }

  function setTextBg(bgValue) {
    selectedTextBg = bgValue;
    if (editingLayerId) {
      layers = layers.map((l) => (l.id === editingLayerId ? { ...l, bg: bgValue } : l));
    }
  }

  function setTextColor(colorValue) {
    selectedTextColor = colorValue;
    if (editingLayerId) {
      layers = layers.map((l) => (l.id === editingLayerId ? { ...l, color: colorValue } : l));
    }
  }

  function setTextFont(fontVal) {
    selectedFontFamily = fontVal;
    fontDropdownOpen = false;
    if (editingLayerId) {
      layers = layers.map((l) => (l.id === editingLayerId ? { ...l, fontFamily: fontVal } : l));
    }
  }

  function finishTextEditing() {
    activeDrawer = "none";
    editingLayerId = null;
    fontDropdownOpen = false;
    recordHistorySnapshot();
  }

  function selectCropAspect(aspectId) {
    cropAspectMode = aspectId;
  }

  function handleEditOverlay(e) {
    const item = e.detail;
    if (!item) return;
    if (item.type === "text") {
      selectedLayerId = item.id;
      editingLayerId = item.id;
      selectedTextColor = item.color || "#ffffff";
      selectedTextBg = item.bg || "rgba(0,0,0,0.7)";
      selectedFontFamily = item.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      activeDrawer = "text";
    } else if (item.type === "link") {
      editingLayerId = item.id;
      linkInputUrl = item.url || "";
      activeDrawer = "link";
    }
  }

  function handleStickerSelect(e) {
    const sticker = e.detail?.sticker || e.detail;
    if (!sticker) return;
    const layer = {
      id: nextLayerId++,
      type: "sticker",
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      sticker
    };
    layers = [...layers, layer];
    selectedLayerId = layer.id;
    activeDrawer = "none";
    recordHistorySnapshot();
  }

  function handleEmojiSelect(e) {
    const emoji = e.detail?.emoji || e.detail;
    if (!emoji) return;
    const layer = {
      id: nextLayerId++,
      type: "emoji",
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      emoji
    };
    layers = [...layers, layer];
    selectedLayerId = layer.id;
    activeDrawer = "none";
    recordHistorySnapshot();
  }

  function handleLayerChange(e) {
    const updated = e.detail;
    layers = layers.map((l) => (l.id === updated.id ? updated : l));
  }

  function handleLayerCommit(e) {
    recordHistorySnapshot();
  }

  function handleLayerDelete(e) {
    const id = e.detail;
    layers = layers.filter((l) => l.id !== id);
    if (selectedLayerId === id) {
      selectedLayerId = null;
    }
    recordHistorySnapshot();
  }

  function openColorPicker(target) {
    colorPickerTarget = target;
    isColorPickerOpen = true;
  }

  function handleColorApply(e) {
    const color = e.detail.color;
    if (colorPickerTarget === "doodle") {
      doodleColor = color;
    } else if (colorPickerTarget === "text-color") {
      setTextColor(color);
    } else if (colorPickerTarget === "text-bg") {
      setTextBg(color);
    }
    isColorPickerOpen = false;
  }

  function handleDoodleHistoryChange(e) {
    canUndoDoodle = e.detail.canUndo;
    canRedoDoodle = e.detail.canRedo;
  }

  async function ensureDiskPath(media, defaultExt = "jpg", isVideo = false) {
    if (typeof media === "string" && !media.startsWith("blob:") && !media.startsWith("data:")) {
      return media;
    }
    if (
      media?.path &&
      typeof media.path === "string" &&
      !media.path.startsWith("blob:") &&
      !media.path.startsWith("data:")
    ) {
      return media.path;
    }
    const blob = media instanceof Blob ? media : media?.blob || media;
    if (!blob) throw new Error("Нет медиафайла для сохранения");
    const buffer = await blob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const ext = media.name?.split(".").pop() || defaultExt;
    return await invoke("save_temp_media", {
      bytes,
      extension: ext,
      isVideo: Boolean(isVideo)
    });
  }

  async function compositePhotoBlob() {
    const canvas = document.createElement("canvas");
    let targetW = 1080;
    let targetH = 1920;

    const origW = mediaNaturalWidth || 1080;
    const origH = mediaNaturalHeight || 1920;

    if (isAttachmentMode) {
      targetW = Math.max(1, Math.round(origW * cropRect.w));
      targetH = Math.max(1, Math.round(origH * cropRect.h));
    }

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (mediaUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = mediaUrl;
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });

      if (img.width && img.height) {
        const imgRatio = img.width / img.height;

        if (isNon916 && !isAttachmentMode) {
          const blurCanvas = document.createElement("canvas");
          blurCanvas.width = 32;
          blurCanvas.height = 56;
          const blurCtx = blurCanvas.getContext("2d");
          if (blurCtx) {
            blurCtx.drawImage(img, 0, 0, 32, 56);
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            let bgW = canvas.width * 1.15;
            let bgH = (canvas.width / imgRatio) * 1.15;
            if (bgH < canvas.height * 1.15) {
              bgH = canvas.height * 1.15;
              bgW = canvas.height * imgRatio * 1.15;
            }
            const bgX = (canvas.width - bgW) / 2;
            const bgY = (canvas.height - bgH) / 2;
            ctx.drawImage(blurCanvas, bgX, bgY, bgW, bgH);
            ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
        }

        if (selectedFilter !== "none") {
          const f = FILTERS.find((x) => x.id === selectedFilter);
          if (f && f.css !== "none") ctx.filter = f.css;
        }

        const scaleRatioX = canvas.width / (previewWidth || 360);
        const scaleRatioY = canvas.height / (previewHeight || 640);
        const exportPanX = mediaPanX * scaleRatioX;
        const exportPanY = mediaPanY * scaleRatioY;
        const exportZoom = mediaZoom || 1.0;

        let baseW = canvas.width;
        let baseH = canvas.width / imgRatio;

        if (isAttachmentMode) {
          const sx = cropRect.x * img.width;
          const sy = cropRect.y * img.height;
          const sw = cropRect.w * img.width;
          const sh = cropRect.h * img.height;
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        } else {
          if (cropRect.w < 0.999 || cropRect.h < 0.999 || cropRect.x > 0.001 || cropRect.y > 0.001) {
            const sx = cropRect.x * img.width;
            const sy = cropRect.y * img.height;
            const sw = cropRect.w * img.width;
            const sh = cropRect.h * img.height;
            const cropRatio = sw / sh;
            let fitW = canvas.width;
            let fitH = canvas.width / cropRatio;
            if (fitH > canvas.height) {
              fitH = canvas.height;
              fitW = canvas.height * cropRatio;
            }
            const posX = (canvas.width - fitW) / 2;
            const posY = (canvas.height - fitH) / 2;
            ctx.drawImage(img, sx, sy, sw, sh, posX, posY, fitW, fitH);
          } else {
            if (baseH < canvas.height && !isNon916) {
              baseH = canvas.height;
              baseW = canvas.height * imgRatio;
            } else if (baseH > canvas.height) {
              baseH = canvas.height;
              baseW = canvas.height * imgRatio;
            }
            const posX = (canvas.width - baseW * exportZoom) / 2 + exportPanX;
            const posY = (canvas.height - baseH * exportZoom) / 2 + exportPanY;
            ctx.drawImage(img, posX, posY, baseW * exportZoom, baseH * exportZoom);
          }
        }
        ctx.filter = "none";

        if (selectedFilter !== "none") {
          try {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            applyFilterToImageData(imgData, selectedFilter);
            ctx.putImageData(imgData, 0, 0);
          } catch (_) {}
        }
      }
    }

    await renderStoryLayersToCanvas(ctx, layers, canvas.width, canvas.height, previewWidth, doodleCanvas);

    return await new Promise((resolve) => {
      canvas.toBlob(resolve, isAttachmentMode && mediaUrl.endsWith(".png") ? "image/png" : "image/jpeg", 0.96);
    });
  }

  async function renderPhotoVideo(photoBlob, audioFile, durationSec = 5) {
    return await renderPhotoToVideoBlob(photoBlob, audioFile, durationSec, {
      isAttachmentMode: Boolean(composerState?.onSave),
      photoVideoDuration
    });
  }

  async function prepareFinalVideoBlob() {
    if (isGif) {
      statusMessage = "Конвертация анимации...";
      return await renderGif(trimStart, trimEnd);
    }
    if (mediaType === "photo" && (isPhotoToVideo || audioTrackFile)) {
      statusMessage = "Создание видео...";
      const finalPhotoBlob = await compositePhotoBlob();
      return await renderPhotoVideo(
        finalPhotoBlob,
        audioTrackFile,
        photoVideoDuration || 5
      );
    }
    const hasLayers = layers && layers.length > 0;
    const hasDoodle = Boolean(doodleCanvas?.hasContent?.());
    const hasFilter = selectedFilter && selectedFilter !== "none";
    const hasTrim = trimStart > 0.05 || (videoDuration > 0 && trimEnd < videoDuration - 0.05);
    const hasCrop = cropRect.w < 0.999 || cropRect.h < 0.999 || cropRect.x > 0.001 || cropRect.y > 0.001;

    if (hasTrim || hasCrop || hasLayers || hasDoodle || hasFilter) {
      statusMessage = "Обработка видео...";
      if (videoMainEl) {
        try {
          const vw = videoMainEl.videoWidth || 720;
          const vh = videoMainEl.videoHeight || 1280;
          const cx = Math.round(cropRect.x * vw);
          const cy = Math.round(cropRect.y * vh);
          const cw = Math.round(cropRect.w * vw);
          const ch = Math.round(cropRect.h * vh);

          let targetWidth = 720;
          let targetHeight = 1280;
          if (isAttachmentMode) {
            targetWidth = Math.min(1280, cw);
            targetHeight = Math.round(targetWidth * (ch / cw));
            if (targetHeight > 1280) {
              targetHeight = 1280;
              targetWidth = Math.round(targetHeight * (cw / ch));
            }
          }
          targetWidth = Math.round(targetWidth / 2) * 2;
          targetHeight = Math.round(targetHeight / 2) * 2;

          const filterCss = selectedFilter !== "none" ? FILTERS.find(x => x.id === selectedFilter)?.css : "none";

          const cutBytes = await cropVideoToMp4(videoMainEl, {
            startSec: trimStart,
            endSec: trimEnd > 0 ? trimEnd : (videoDuration || 15),
            cropX: cx,
            cropY: cy,
            cropWidth: cw,
            cropHeight: ch,
            targetWidth,
            targetHeight,
            layers,
            doodleCanvas,
            previewWidth,
            filterCss
          });
          return new Blob([cutBytes], { type: "video/mp4" });
        } catch {}
      }
    }
    return capturedMedia.blob;
  }

  async function handlePublish() {
    if (isPublishing || !capturedMedia) return;
    isPublishing = true;
    statusMessage = composerState?.onSave ? "Сохранение..." : "Подготовка...";

    try {
      if (composerState?.onSave) {
        if (mediaType === "video" || (mediaType === "photo" && isPhotoToVideo)) {
          const finalVideoBlob = await prepareFinalVideoBlob();
          const tempPath = await ensureDiskPath(
            finalVideoBlob || capturedMedia.path,
            "mp4",
            true
          );
          composerState.onSave({ path: tempPath, isVideo: true });
        } else {
          const finalPhotoBlob = await compositePhotoBlob();
          const tempPath = await ensureDiskPath(finalPhotoBlob, "jpg", false);
          composerState.onSave({ path: tempPath, isVideo: false });
        }
        handleClose();
        return;
      }

      const payloadLayers = layers
        .filter((l) => l.type === "link" && l.url)
        .map((l) => ({
          type: 0,
          coordinates: {
            x: l.x,
            y: l.y,
            w: 0.75,
            h: 0.05,
            rotation: l.rotation || 0
          },
          clickableLink: { url: l.url }
        }));

      if (mediaType === "video" || (mediaType === "photo" && (isPhotoToVideo || audioTrackFile))) {
        statusMessage = "Обработка видео...";
        const exportBlob = await prepareFinalVideoBlob();
        const tempPath = await ensureDiskPath(
          exportBlob || capturedMedia.path,
          "mp4",
          true
        );
        const durMs = Math.round((trimEnd - trimStart || videoDuration || photoVideoDuration || 15) * 1000);

        statusMessage = "Загрузка видео...";
        const tokenObj = await $API.uploadStoryVideo(tempPath, durMs);
        await $API.publishVideoStory({
          videoToken: tokenObj.token,
          durationMs: durMs,
          settings: audience,
          layers: payloadLayers,
          isMuted: isAudioMuted
        });
      } else {
        statusMessage = "Создание фото-истории...";
        const finalPhotoBlob = await compositePhotoBlob();
        const tempPath = await ensureDiskPath(finalPhotoBlob, "jpg", false);

        statusMessage = "Загрузка фото...";
        const token = await $API.uploadStoryPhoto(tempPath);
        await $API.publishPhotoStory({
          photoToken: token,
          settings: audience,
          layers: payloadLayers
        });
      }

      const myId = Number($currentUser);
      const isVid = mediaType === "video" || isPhotoToVideo || Boolean(audioTrackFile);
      const newStoryItem = {
        id: Date.now(),
        cid: Date.now(),
        media: isVid
          ? {
              _type: "VIDEO",
              path: mediaFile?.path || null,
              thumbnail: filterThumbnailUrl || ""
            }
          : {
              _type: "PHOTO",
              baseUrl: mediaUrl || "",
              path: mediaFile?.path || null
            },
        layers: payloadLayers,
        settings: audience,
        expiration: 172800000
      };
      if (myId) {
        addStoryLocally(myId, newStoryItem);
      }

      await refreshStoriesFeed($API);
      handleClose();
    } catch (err) {
      const errMsg = err?.message || String(err);
      statusMessage = "Ошибка: " + errMsg;
      showAlert("Ошибка при публикации истории: " + errMsg);
    } finally {
      isPublishing = false;
    }
  }

  function handleClose() {
    stopCamera();
    stopVideoRecording();
    stopPlaybackLoop();
    if (videoMainEl) {
      try {
        videoMainEl.pause();
        videoMainEl.removeAttribute("src");
        videoMainEl.load();
      } catch (_) {}
    }
    if (mediaUrl && mediaUrl.startsWith("blob:")) {
      URL.revokeObjectURL(mediaUrl);
    }
    mediaUrl = null;
    capturedMedia = null;
    mediaFile = null;
    gifDecoder = null;
    isGif = false;
    audioTrackFile = null;
    audioTrackName = "";
    isOpen = false;
    closeStoryComposer();
    dispatch("close");
  }
</script>

{#if isOpen}
  <div
    class="composer-overlay"
    role="dialog"
    aria-modal="true"
    transition:fade={{ duration: 180 }}
  >
    <StoryComposerHeader
      {mode}
      {canUndoOverlay}
      {canRedoOverlay}
      {canUndoDoodle}
      {canRedoDoodle}
      {activeDrawer}
      {isAttachmentMode}
      {mediaType}
      {isAudioMuted}
      on:close={handleClose}
      on:undo={undoOverlay}
      on:redo={redoOverlay}
      on:undoDoodle={() => doodleCanvas?.undo()}
      on:redoDoodle={() => doodleCanvas?.redo()}
      on:toggleDrawer={(e) => toggleDrawer(e.detail)}
      on:toggleMute={() => {
        isAudioMuted = !isAudioMuted;
        if (videoMainEl) videoMainEl.muted = isAudioMuted;
      }}
      on:selectAudio={(e) => {
        audioTrackFile = e.detail.file;
        audioTrackName = e.detail.file?.name || "";
      }}
    />

    <div
      class="composer-middle-workspace"
      class:has-trimmer={hasTrimmer}
      on:pointerdown={handleMediaPointerDown}
      on:mousedown={handleMediaPointerDown}
      role="presentation"
    >
      {#if mode === "camera"}
        <div class="camera-stream-wrapper">
          <video
            bind:this={videoPreviewEl}
            autoplay
            playsinline
            muted
            poster="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"
            class="camera-stream-video"
            class:mirror={facingMode === "user"}
            on:playing={() => (cameraFreezeSnapshotUrl = "")}
            style="filter: {selectedFilter !== 'none' ? FILTERS.find(x => x.id === selectedFilter)?.css : 'none'};"
          ></video>

          {#if cameraFreezeSnapshotUrl}
            <img
              src={cameraFreezeSnapshotUrl}
              alt=""
              class="camera-stream-video camera-freeze-frame"
            />
          {/if}

          {#if isProcessingRecord}
            <div class="camera-processing-overlay" transition:fade={{ duration: 150 }}>
              <div class="processing-spinner"></div>
            </div>
          {/if}

          {#if isRecording}
            <div class="camera-record-badge">
              <div class="record-pulse-dot"></div>
              <span>{formatRecordTimer(recordDurationSec)} / 00:{MAX_RECORD_SEC < 10 ? '0' : ''}{MAX_RECORD_SEC}</span>
            </div>
          {/if}

          <div class="camera-floating-controls">
            <button
              type="button"
              class="gallery-picker-btn"
              title="Выбрать файл"
              on:click={handlePickGalleryMedia}
            >
              <img src="/icons/stories/gallery.svg" alt="" width="22" height="22" />
            </button>
            <input
              bind:this={fallbackFileInput}
              type="file"
              accept="image/*,video/*"
              on:change={handleFileSelected}
              style="display: none;"
            />

            <button
              type="button"
              class="camera-shutter-btn"
              class:recording={isRecording}
              on:click={handleCapturePhoto}
              on:pointerdown={startVideoRecording}
              on:pointerup={stopVideoRecording}
              title="Нажмите для фото, удерживайте для видео"
              aria-label="Сделать снимок или записать видео"
            >
              {#if isRecording}
                <svg class="shutter-progress-ring" viewBox="0 0 80 80">
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    class="progress-ring-circle"
                    style="stroke-dashoffset: {226.19 * (1 - recordDurationSec / MAX_RECORD_SEC)};"
                  />
                </svg>
              {/if}
              <div class="shutter-inner-dot"></div>
            </button>

            <button
              type="button"
              class="camera-switch-btn"
              on:click={toggleCamera}
              title="Сменить камеру"
              aria-label="Сменить камеру"
            >
              <img src="/icons/flip-camera.svg" alt="" width="22" height="22" />
            </button>
          </div>
        </div>
      {:else}
        <div
          class="story-preview-wrapper"
          style="aspect-ratio: {targetAspect}; max-width: min(calc(100vh * {targetAspect} - 120px), 100%);"
          use:observeCanvasSize
          on:pointerdown={handleMediaPointerDown}
          on:mousedown={handleMediaPointerDown}
          on:click={handleMediaClick}
          on:wheel={handleMediaWheel}
          role="presentation"
        >
          {#if isNon916 && !isAttachmentMode && (filterThumbnailUrl || mediaType !== "video")}
            <div class="story-blurred-bg" aria-hidden="true">
              <img
                src={filterThumbnailUrl || mediaUrl}
                alt=""
                class="blurred-bg-media"
              />
            </div>
          {/if}

          <div
            class="story-transform-stage"
            style="transform: translate({mediaPanX}px, {mediaPanY}px) scale({mediaZoom});"
          >
            {#if isGif}
              <canvas
                bind:this={gifPreviewCanvas}
                width={mediaNaturalWidth || 720}
                height={mediaNaturalHeight || 1280}
                class="story-main-media"
                style="{mediaClipStyle} filter: {selectedFilter !== 'none' ? FILTERS.find(x => x.id === selectedFilter)?.css : 'none'};"
              ></canvas>
            {:else if mediaType === "video"}
              <video
                bind:this={videoMainEl}
                src={mediaUrl}
                class="story-main-media"
                autoplay
                muted={isAudioMuted}
                playsinline
                preload="metadata"
                poster="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"
                on:loadedmetadata={handleVideoLoadedMetadata}
                on:loadeddata={generateVideoThumbnail}
                on:canplay={handleVideoCanPlay}
                on:play={startPlayheadSync}
                on:pause={stopPlayheadSync}
                on:ended={handleVideoEnded}
                on:timeupdate={handleVideoTimeUpdate}
                style="{mediaClipStyle} filter: {selectedFilter !== 'none' ? FILTERS.find(x => x.id === selectedFilter)?.css : 'none'};"
              ></video>
            {:else}
              <img
                src={mediaUrl}
                alt=""
                class="story-main-media"
                on:load={handleImageLoad}
                style="{mediaClipStyle} filter: {selectedFilter !== 'none' ? FILTERS.find(x => x.id === selectedFilter)?.css : 'none'};"
              />
            {/if}

            <StoryDoodleCanvas
              bind:this={doodleCanvas}
              isEnabled={isDrawingMode}
              brushColor={doodleColor}
              brushSize={doodleSize}
              width={previewWidth}
              height={previewHeight}
              on:historyChange={handleDoodleHistoryChange}
            />

            {#each layers as layer (layer.id)}
              <StoryOverlayItem
                item={layer}
                isSelected={selectedLayerId === layer.id}
                isEditing={activeDrawer === "text" && editingLayerId === layer.id}
                containerWidth={previewWidth}
                containerHeight={previewHeight}
                on:select={(e) => {
                  selectedLayerId = e.detail;
                  editingLayerId = null;
                }}
                on:change={handleLayerChange}
                on:commit={handleLayerCommit}
                on:edit={handleEditOverlay}
                on:stopEdit={(e) => {
                  editingLayerId = null;
                  selectedLayerId = e.detail?.id || layer.id;
                }}
                on:delete={handleLayerDelete}
              />
            {/each}
          </div>

          {#if isNon916 && !isAttachmentMode && activeDrawer !== "crop"}
            <div class="framing-guides-overlay" aria-hidden="true">
              <div class="framing-badge">9:16</div>
            </div>
          {/if}

          {#if (mediaType === "video" || isGif) && isVideoPaused && !isDrawingMode && activeDrawer !== "drawing"}
            <div class="composer-play-badge" on:click|stopPropagation={toggleMediaPlayback} aria-label="Воспроизвести">
              <img src="/icons/stories/play.svg" alt="" width="38" height="38" />
            </div>
          {/if}

          {#if activeDrawer === "crop"}
            <StoryCropOverlay
              bind:this={cropOverlayRef}
              crop={cropRect}
              containerWidth={previewWidth}
              containerHeight={previewHeight}
              imageBounds={imgBounds}
              on:change={(e) => {
                currentCropDraft = e.detail.crop;
                isCropModified = e.detail.isModified;
              }}
            />
          {/if}
        </div>

        {#if hasTrimmer}
          <div class="video-trimmer-section interactive-ctrl">
            <StoryTrimmer
              videoDuration={videoDuration || photoVideoDuration || 5}
              currentTime={videoCurrentTime}
              {trimStart}
              {trimEnd}
              on:change={handleTrimmerChange}
              on:seek={handleTrimmerSeek}
            />
          </div>
        {/if}

        {#if audioTrackName}
          <div class="audio-pill-bar interactive-ctrl" transition:fade={{ duration: 150 }}>
            <div class="audio-info">
              <img src="/icons/stories/music.svg" alt="" width="14" height="14" />
              <span>{audioTrackName}</span>
            </div>
            <button type="button" class="audio-del-btn" on:click={removeAudio}>✕</button>
          </div>
        {/if}
      {/if}
    </div>

    {#if mode === "edit"}
      <div class="composer-dedicated-footer">
        {#if activeDrawer !== "none"}
          <StoryDrawer
            {activeDrawer}
            {hasTrimmer}
            filters={FILTERS}
            {selectedFilter}
            {filterThumbnailUrl}
            {mediaUrl}
            isVideoStory={mediaType === "video"}
            textBgOptions={TEXT_BG_OPTIONS}
            {selectedTextBg}
            presetColors={PRESET_COLORS}
            {selectedTextColor}
            {availableFonts}
            {selectedFontFamily}
            bind:fontDropdownOpen
            {doodleColor}
            bind:doodleSize
            {doodleCanvas}
            cropModified={isCropModified}
            on:selectFilter={(e) => (selectedFilter = e.detail)}
            on:setTextBg={(e) => setTextBg(e.detail)}
            on:setTextColor={(e) => setTextColor(e.detail)}
            on:setTextFont={(e) => setTextFont(e.detail)}
            on:openColorPicker={(e) => openColorPicker(e.detail)}
            on:finishText={finishTextEditing}
            on:close={() => (activeDrawer = "none")}
            on:cropApply={() => {
              cropRect = { ...currentCropDraft };
              activeDrawer = "none";
            }}
            on:cropReset={() => {
              cropOverlayRef?.reset?.();
              cropRect = { x: 0, y: 0, w: 1, h: 1 };
              currentCropDraft = { ...cropRect };
              isCropModified = false;
            }}
            on:cropCancel={() => {
              currentCropDraft = { ...cropRect };
              activeDrawer = "none";
            }}
          />
        {:else}
          <div class="footer-control-row">
            {#if mediaType === "photo"}
              <div class="sliding-switch-container">
                <div
                  class="sliding-switch-pill"
                  style="transform: translateX({isPhotoToVideo ? '100%' : '0%'});"
                ></div>
                <button
                  type="button"
                  class="switch-tab-btn"
                  class:active={!isPhotoToVideo}
                  on:click={() => (isPhotoToVideo = false)}
                >
                  Фото
                </button>
                <button
                  type="button"
                  class="switch-tab-btn"
                  class:active={isPhotoToVideo}
                  on:click={() => {
                    isPhotoToVideo = true;
                    if (!videoDuration || videoDuration <= 0) {
                      videoDuration = photoVideoDuration || 5;
                      trimStart = 0;
                      trimEnd = videoDuration;
                    }
                  }}
                >
                  Видео
                </button>
              </div>
            {/if}

            {#if !composerState?.onSave}
              <div class="sliding-switch-container">
                <div
                  class="sliding-switch-pill"
                  style="transform: translateX({audience === 2 ? '100%' : '0%'});"
                ></div>
                <button
                  type="button"
                  class="switch-tab-btn"
                  class:active={audience === 1}
                  on:click={() => (audience = 1)}
                >
                  Все
                </button>
                <button
                  type="button"
                  class="switch-tab-btn"
                  class:active={audience === 2}
                  on:click={() => (audience = 2)}
                >
                  Контакты
                </button>
              </div>
            {/if}
          </div>

          <button
            type="button"
            class="composer-send-btn"
            disabled={isPublishing}
            on:click={handlePublish}
          >
            {#if isPublishing}
              <div class="btn-spinner"></div>
              <span>{composerState?.onSave ? "Сохранить" : "Залить"}</span>
            {:else}
              <span>{composerState?.onSave ? "Сохранить" : "Залить"}</span>
              <img src="/icons/send.svg" alt="" width="18" height="18" />
            {/if}
          </button>
        {/if}
      </div>
    {/if}

    {#if activeDrawer === "link"}
      <div class="sub-modal-backdrop" transition:fade={{ duration: 150 }} on:click|self={() => (activeDrawer = "none")}>
        <div class="sub-modal-card" transition:fly={{ y: 20, duration: 180 }}>
          <h3>{editingLayerId ? "Редактировать ссылку" : "Добавить ссылку"}</h3>
          <input
            type="url"
            bind:value={linkInputUrl}
            placeholder="https://example.com"
            class="modal-input"
          />
          <div class="sub-modal-buttons">
            <button type="button" class="sub-modal-cancel" on:click={() => (activeDrawer = "none")}>
              Отмена
            </button>
            <button type="button" class="sub-modal-confirm" on:click={addLinkLayer}>
              {editingLayerId ? "Обновить" : "Добавить"}
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if activeDrawer === "stickers"}
      <div
        class="sub-modal-backdrop"
        transition:fade={{ duration: 150 }}
        on:click|self={() => (activeDrawer = "none")}
      >
        <div class="sticker-sheet-panel" transition:fly={{ y: 80, duration: 200 }}>
          <div class="sticker-sheet-header">
            <h3>Стикеры и эмодзи</h3>
            <button type="button" class="sheet-close-btn" on:click={() => (activeDrawer = "none")}>✕</button>
          </div>
          <div class="sticker-sheet-content">
            <StickerPanel
              on:sendSticker={handleStickerSelect}
              on:insertEmoji={handleEmojiSelect}
              on:stickerSelect={handleStickerSelect}
              on:emojiSelect={handleEmojiSelect}
            />
          </div>
        </div>
      </div>
    {/if}

    {#if isColorPickerOpen}
      <div
        class="color-picker-portal"
        transition:fade={{ duration: 140 }}
        on:click|self={() => (isColorPickerOpen = false)}
      >
        <div class="color-picker-card" transition:fly={{ y: 20, duration: 160 }}>
          <ColorPicker
            color={colorPickerTarget === "doodle"
              ? doodleColor
              : colorPickerTarget === "text-color"
              ? selectedTextColor
              : selectedTextBg}
            on:color={handleColorApply}
            on:close={() => (isColorPickerOpen = false)}
          />
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .composer-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 7);
    background: #000000;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }

  .composer-middle-workspace {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000000;
    overflow: hidden;
    transition: padding-bottom 0.2s ease;
  }

  .composer-middle-workspace.has-trimmer {
    padding-bottom: 98px;
  }

  .camera-stream-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000000;
  }

  .camera-freeze-frame {
    position: absolute;
    inset: 0;
    filter: blur(14px) brightness(0.9);
    transform: scale(1.05);
    z-index: 1;
    pointer-events: none;
  }

  .camera-processing-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    pointer-events: all;
  }

  .processing-spinner {
    width: 44px;
    height: 44px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .camera-stream-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .camera-stream-video.mirror {
    transform: scaleX(-1);
  }

  .camera-record-badge {
    position: absolute;
    top: calc(16px + var(--safe-area-top, var(--safe-top, 0px)));
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 6px 14px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    z-index: var(--z-header, 4);
  }

  .record-pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
    animation: pulseDot 1s infinite;
  }

  @keyframes pulseDot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.85); }
  }

  .camera-floating-controls {
    position: absolute;
    bottom: calc(32px + var(--safe-area-bottom, var(--safe-bottom, 0px)));
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 32px;
    z-index: var(--z-header, 4);
  }

  .camera-shutter-btn {
    position: relative;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    background: transparent;
    border: 4px solid #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .camera-shutter-btn:active {
    transform: scale(0.92);
  }
  .camera-shutter-btn.recording {
    border-color: #ef4444;
    animation: shutterPulse 1s infinite;
  }
  .shutter-inner-dot {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: #ffffff;
    transition: transform 0.18s, border-radius 0.18s, background 0.18s;
  }
  .camera-shutter-btn.recording .shutter-inner-dot {
    background: #ef4444;
    transform: scale(0.65);
    border-radius: 8px;
  }

  .shutter-progress-ring {
    position: absolute;
    inset: -6px;
    width: calc(100% + 12px);
    height: calc(100% + 12px);
    transform: rotate(-90deg);
    pointer-events: none;
  }

  .progress-ring-circle {
    fill: none;
    stroke: #ef4444;
    stroke-width: 4px;
    stroke-dasharray: 226.19;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.25s linear;
  }

  @keyframes shutterPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }

  .gallery-picker-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(8px);
  }

  .camera-switch-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s, background-color 0.15s;
    backdrop-filter: blur(8px);
  }
  .camera-switch-btn:hover {
    background: rgba(0, 0, 0, 0.85);
    transform: scale(1.08);
  }

  .story-preview-wrapper {
    position: relative;
    aspect-ratio: 9 / 16;
    height: 100%;
    max-width: calc(100vh * 9 / 16);
    background: #000000;
    overflow: hidden;
    touch-action: none;
  }

  @media (max-width: 768px) {
    .story-preview-wrapper {
      width: 100%;
      height: 100%;
      max-width: 100%;
      border-radius: 0 !important;
    }
  }

  .story-blurred-bg {
    position: absolute;
    inset: -32px;
    z-index: var(--z-base, 1);
    overflow: hidden;
    pointer-events: none;
    background: #000000;
  }

  .blurred-bg-media {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scale(1.25);
    -webkit-filter: blur(28px) brightness(0.65);
    filter: blur(28px) brightness(0.65);
    opacity: 0.85;
  }

  .composer-play-badge {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    cursor: pointer;
    z-index: var(--z-sheet, 7);
    transition: transform 0.15s, background 0.15s;
  }

  .composer-play-badge:hover {
    transform: translate(-50%, -50%) scale(1.08);
    background: rgba(0, 0, 0, 0.7);
  }

  .story-transform-stage {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform-origin: center center;
    z-index: var(--z-panel, 2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .story-main-media {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: var(--z-panel, 2);
    transform-origin: center center;
    transition: filter 0.35s ease;
  }

  .framing-guides-overlay {
    position: absolute;
    inset: 0;
    z-index: var(--z-chat, 3);
    pointer-events: none;
    border: 1.5px solid rgba(255, 255, 255, 0.35);
  }

  .framing-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    padding: 3px 8px;
    background: rgba(0, 0, 0, 0.65);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 11px;
    font-weight: 600;
  }

  .video-trimmer-section {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(13, 14, 18, 0.95);
    backdrop-filter: blur(12px);
    padding: 8px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    z-index: var(--z-sheet, 7);
  }

  .composer-middle-workspace.has-trimmer .audio-pill-bar {
    bottom: 82px;
  }

  .audio-pill-bar {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: rgba(28, 42, 56, 0.92);
    backdrop-filter: blur(8px);
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    border-radius: 20px;
    border: 1px solid rgba(59, 130, 246, 0.4);
    z-index: var(--z-sheet, 7);
  }
  .audio-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .audio-del-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
  }
  .audio-del-btn:hover {
    color: #ef4444;
  }

  .composer-dedicated-footer {
    min-height: 48px;
    height: auto;
    background: #000000;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px calc(6px + var(--safe-area-bottom, var(--safe-bottom, env(safe-area-inset-bottom, 0px)))) 10px;
    z-index: var(--z-header, 4);
    flex-shrink: 0;
    gap: 6px;
  }

  .footer-control-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .sliding-switch-container {
    position: relative;
    display: flex;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 2px;
    flex: 1;
    min-width: 90px;
    max-width: 136px;
    height: 32px;
    box-sizing: border-box;
    user-select: none;
    flex-shrink: 1;
  }

  .sliding-switch-pill {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc(50% - 2px);
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    border-radius: 14px;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.45);
    transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
    pointer-events: none;
  }

  .switch-tab-btn {
    flex: 1;
    position: relative;
    z-index: var(--z-base, 1);
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.65);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 14px;
    transition: color 0.18s ease;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .switch-tab-btn.active {
    color: #ffffff;
    font-weight: 600;
  }

  .composer-send-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 32px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 16px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.18s, transform 0.18s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .composer-send-btn:hover:not(:disabled) {
    background: #2563eb;
    transform: scale(1.03);
  }
  .composer-send-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .sub-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal, 7);
    padding: 16px;
    box-sizing: border-box;
  }

  .sub-modal-card {
    background: #1c1d22;
    border-radius: 20px;
    padding: 20px;
    width: 100%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  }

  .sub-modal-card h3 {
    margin: 0;
    color: #ffffff;
    font-size: 18px;
    font-weight: 600;
  }

  .modal-input {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 12px 14px;
    color: #ffffff;
    font-size: 15px;
    outline: none;
    box-sizing: border-box;
  }
  .modal-input:focus {
    border-color: #3b82f6;
  }

  .sub-modal-buttons {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .sub-modal-cancel {
    padding: 9px 16px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 10px;
    color: #ffffff;
    font-size: 14px;
    cursor: pointer;
  }
  .sub-modal-confirm {
    padding: 9px 18px;
    background: #3b82f6;
    border: none;
    border-radius: 10px;
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .sticker-sheet-panel {
    background: #181920;
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    width: 100%;
    max-width: 500px;
    height: 52vh;
    max-height: 480px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: absolute;
    bottom: 0;
    padding-bottom: var(--safe-area-bottom, var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
  }
  .sticker-sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .sticker-sheet-header h3 {
    margin: 0;
    color: #ffffff;
    font-size: 16px;
    font-weight: 600;
  }
  .sheet-close-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 16px;
  }
  .sticker-sheet-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sticker-sheet-content :global(.sticker-panel-wrapper) {
    height: 100% !important;
    max-height: 100% !important;
    flex: 1;
    border-top: none;
  }

  .color-picker-portal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-picker, 110);
    padding: 16px;
  }
  .color-picker-card {
    background: #1c1d22;
    border-radius: 18px;
    padding: 16px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
  }
</style>
