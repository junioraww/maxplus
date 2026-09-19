<script>
  import { onMount, onDestroy } from "svelte";
  import {
    minimizedWebApps,
    restoreMiniApp,
    closeMiniApp,
  } from "$lib/stores/webapp.js";

  let positions = {};
  let draggingId = null;
  let startPointerX = 0;
  let startPointerY = 0;
  let startPillX = 0;
  let startPillY = 0;
  let hasDragged = false;

  function clamp(val, min, max) {
    if (min > max) return min;
    return Math.min(Math.max(val, min), max);
  }

  function resolveRepulsion() {
    const ids = $minimizedWebApps.map((a) => a.id);
    if (ids.length < 2) return;
    const margin = 12;
    const gap = 12;
    const maxIter = 20;
    const winW = typeof window !== "undefined" ? window.innerWidth : 360;
    const winH = typeof window !== "undefined" ? window.innerHeight : 640;

    for (let iter = 0; iter < maxIter; iter++) {
      let anyCollision = false;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const idA = ids[i];
          const idB = ids[j];
          const a = positions[idA];
          const b = positions[idB];
          if (!a || !b) continue;

          const cxA = a.x + a.width / 2;
          const cyA = a.y + a.height / 2;
          const cxB = b.x + b.width / 2;
          const cyB = b.y + b.height / 2;

          const minDx = (a.width + b.width) / 2 + gap;
          const minDy = (a.height + b.height) / 2 + gap;

          let dx = cxB - cxA;
          let dy = cyB - cyA;

          const overlapX = minDx - Math.abs(dx);
          const overlapY = minDy - Math.abs(dy);

          if (overlapX > 0 && overlapY > 0) {
            anyCollision = true;
            if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
              dx = 1;
              dy = 0.5;
            }

            if (overlapX < overlapY) {
              const sign = dx >= 0 ? 1 : -1;
              const shift = (overlapX + 2) * sign;
              a.x -= shift * 0.5;
              b.x += shift * 0.5;
            } else {
              const sign = dy >= 0 ? 1 : -1;
              const shift = (overlapY + 2) * sign;
              a.y -= shift * 0.5;
              b.y += shift * 0.5;
            }

            a.x = clamp(a.x, margin, winW - a.width - margin);
            a.y = clamp(a.y, margin, winH - a.height - margin);
            b.x = clamp(b.x, margin, winW - b.width - margin);
            b.y = clamp(b.y, margin, winH - b.height - margin);
          }
        }
      }
      if (!anyCollision) break;
    }
    positions = { ...positions };
  }

  $: {
    const currentList = $minimizedWebApps;
    const currentIds = new Set(currentList.map((a) => a.id));
    let changed = false;

    for (const key of Object.keys(positions)) {
      if (!currentIds.has(key)) {
        delete positions[key];
        changed = true;
      }
    }

    currentList.forEach((app, idx) => {
      if (!positions[app.id]) {
        const w = 140;
        const h = 38;
        const margin = 12;
        const winW = typeof window !== "undefined" ? window.innerWidth : 360;
        const winH = typeof window !== "undefined" ? window.innerHeight : 640;
        const totalW = currentList.length * w + (currentList.length - 1) * 10;
        const startX = Math.max(margin, (winW - totalW) / 2);
        const initX = clamp(startX + idx * (w + 10), margin, winW - w - margin);
        const initY = clamp(winH - 76, margin, winH - h - margin);
        positions[app.id] = { x: initX, y: initY, width: w, height: h };
        changed = true;
      }
    });

    if (changed) {
      resolveRepulsion();
    }
  }

  let restoringId = null;

  function handlePointerDown(e, id) {
    if (e.target.closest(".pill-close-btn")) return;
    draggingId = id;
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    const p = positions[id] || { x: 16, y: 100, width: 140, height: 38 };
    startPillX = p.x;
    startPillY = p.y;
    hasDragged = false;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    e.preventDefault();
  }

  function handlePointerMove(e) {
    if (!draggingId) return;
    const dx = e.clientX - startPointerX;
    const dy = e.clientY - startPointerY;
    if (Math.hypot(dx, dy) > 5) {
      hasDragged = true;
    }
    const p = positions[draggingId];
    const w = p?.width || 140;
    const h = p?.height || 38;
    const margin = 12;
    const winW = typeof window !== "undefined" ? window.innerWidth : 360;
    const winH = typeof window !== "undefined" ? window.innerHeight : 640;

    const newX = clamp(startPillX + dx, margin, winW - w - margin);
    const newY = clamp(startPillY + dy, margin, winH - h - margin);
    positions[draggingId] = { ...p, x: newX, y: newY, width: w, height: h };
    positions = { ...positions };
  }

  function handlePointerUp() {
    if (!draggingId) return;
    const currentId = draggingId;
    const didDrag = hasDragged;
    draggingId = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);

    if (!didDrag) {
      restoringId = currentId;
      setTimeout(() => {
        restoreMiniApp(currentId);
        restoringId = null;
      }, 160);
      return;
    }

    resolveRepulsion();
  }

  function handleResize() {
    const margin = 12;
    const winW = typeof window !== "undefined" ? window.innerWidth : 360;
    const winH = typeof window !== "undefined" ? window.innerHeight : 640;
    for (const key of Object.keys(positions)) {
      const p = positions[key];
      p.x = clamp(p.x, margin, winW - p.width - margin);
      p.y = clamp(p.y, margin, winH - p.height - margin);
    }
    resolveRepulsion();
  }

  onMount(() => {
    window.addEventListener("resize", handleResize);
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    }
  });
</script>

{#if $minimizedWebApps.length > 0}
  <div class="dock-container">
    {#each $minimizedWebApps as app (app.id)}
      {@const pos = positions[app.id] || { x: 16, y: 500 }}
      <div
        class="dock-pill"
        class:dragging={draggingId === app.id}
        class:restoring={restoringId === app.id}
        style="transform: translate3d({pos.x}px, {pos.y}px, 0);"
        on:pointerdown={(e) => handlePointerDown(e, app.id)}
        title="Развернуть"
      >
        <div class="pill-avatar">
          {(app.title || "W")[0].toUpperCase()}
        </div>
        <span class="pill-title">{app.title}</span>
        <button
          class="pill-close-btn"
          on:click|stopPropagation={() => closeMiniApp(app.id)}
          title="Закрыть"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .dock-container {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none;
    overflow: hidden;
  }

  .dock-pill {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: auto;
    touch-action: none;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #222428;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 20px;
    padding: 4px 8px 4px 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    cursor: grab;
    user-select: none;
    animation: pillFadeIn 0.24s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2), background 0.15s ease, box-shadow 0.2s ease, opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform, opacity;
  }

  .dock-pill.restoring {
    opacity: 0 !important;
    pointer-events: none;
  }

  @keyframes pillFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .dock-pill.dragging {
    transition: none;
    cursor: grabbing;
    z-index: 1002;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.6);
  }

  .dock-pill:hover:not(.dragging) {
    background: #2a2d32;
  }

  .pill-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #3b82f6;
    color: #fff;
    font-size: 11px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .pill-title {
    font-size: 12px;
    font-weight: 500;
    color: #e5e7eb;
    max-width: 110px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  .pill-close-btn {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: #9ca3af;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .pill-close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
</style>
