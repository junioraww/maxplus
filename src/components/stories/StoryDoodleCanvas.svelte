<script>
  import { onMount, createEventDispatcher } from "svelte";

  export let isEnabled = false;
  export let brushColor = "#ff4444";
  export let brushSize = 6;
  export let width = 360;
  export let height = 640;

  const dispatch = createEventDispatcher();

  let canvasEl;
  let ctx;
  let isDrawing = false;
  let currentStroke = [];
  let strokes = [];
  let redoStack = [];

  $: if (canvasEl && (width || height)) {
    resizeCanvas();
  }

  $: if (isEnabled && canvasEl) {
    redrawAll();
  }

  function resizeCanvas() {
    if (!canvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = width * dpr;
    canvasEl.height = height * dpr;
    ctx = canvasEl.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      redrawAll();
    }
  }

  onMount(() => {
    resizeCanvas();
  });

  function handlePointerDown(e) {
    if (!isEnabled) return;
    e.stopPropagation();
    isDrawing = true;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    currentStroke = [{ x, y }];
    drawPoint(x, y, brushColor, brushSize);
  }

  function handlePointerMove(e) {
    if (!isEnabled || !isDrawing) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    currentStroke.push({ x, y });
    drawSegment(currentStroke, brushColor, brushSize);
  }

  function handlePointerUp() {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentStroke.length > 0) {
      strokes.push({
        color: brushColor,
        size: brushSize,
        points: [...currentStroke]
      });
      currentStroke = [];
      redoStack = [];
      redrawAll();
      dispatch("historyChange", { canUndo: strokes.length > 0, canRedo: redoStack.length > 0 });
    }
  }

  function drawPoint(x, y, color, size) {
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSegment(points, color, size) {
    if (!ctx || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    const p1 = points[points.length - 2];
    const p2 = points[points.length - 1];
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }

  function redrawAll() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokes) {
      if (stroke.points.length === 1) {
        drawPoint(stroke.points[0].x, stroke.points[0].y, stroke.color, stroke.size);
      } else if (stroke.points.length > 1) {
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          const xc = (stroke.points[i].x + stroke.points[i - 1].x) / 2;
          const yc = (stroke.points[i].y + stroke.points[i - 1].y) / 2;
          ctx.quadraticCurveTo(stroke.points[i - 1].x, stroke.points[i - 1].y, xc, yc);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  export function undo() {
    if (strokes.length === 0) return;
    const popped = strokes.pop();
    redoStack.push(popped);
    redrawAll();
    dispatch("historyChange", { canUndo: strokes.length > 0, canRedo: redoStack.length > 0 });
  }

  export function redo() {
    if (redoStack.length === 0) return;
    const restored = redoStack.pop();
    strokes.push(restored);
    redrawAll();
    dispatch("historyChange", { canUndo: strokes.length > 0, canRedo: redoStack.length > 0 });
  }

  export function clear() {
    if (strokes.length === 0) return;
    redoStack = [...strokes, ...redoStack];
    strokes = [];
    redrawAll();
    dispatch("historyChange", { canUndo: false, canRedo: redoStack.length > 0 });
  }

  export function getCanvas() {
    return canvasEl;
  }

  export function hasContent() {
    return strokes.length > 0;
  }
</script>

<canvas
  bind:this={canvasEl}
  class="doodle-canvas"
  class:interactive={isEnabled}
  style="width: {width}px; height: {height}px;"
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
></canvas>

<style>
  .doodle-canvas {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: var(--z-panel, 2);
    touch-action: none;
  }
  .doodle-canvas.interactive {
    pointer-events: auto;
    cursor: crosshair;
  }
</style>
