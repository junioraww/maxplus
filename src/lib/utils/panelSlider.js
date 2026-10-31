export function panelSlider(node, options = {}) {
  let {
    getPagesCount = () => 0,
    getActive = () => 0,
    canDrag = () => true,
    onPrepare = () => {},
    onDragStart = () => {},
    onDragMove = () => {},
    onDragEnd = () => {},
  } = options;

  let touchStartX = 0;
  let touchStartY = 0;
  let isTouchTracking = false;
  let isDragEngaged = false;
  let touchHistory = [];

  let mouseStartX = 0;
  let mouseStartY = 0;
  let isMouseTracking = false;
  let isMouseEngaged = false;
  let mouseHistory = [];
  let activeMouseMove = null;
  let activeMouseUp = null;

  function calculateOffset(diffX, active, total) {
    if (active === 0 && diffX > 0) {
      return diffX * 0.28;
    }
    if (active === total - 1 && diffX < 0) {
      return diffX * 0.28;
    }
    return diffX;
  }

  function computeVelocity(history) {
    if (history.length < 2) return 0;
    const first = history[0];
    const last = history[history.length - 1];
    const dt = last.time - first.time;
    if (dt <= 0) return 0;
    return (last.x - first.x) / dt;
  }

  function resolveTarget(offset, velocity, active, total, width) {
    const threshold = width * 0.22;
    const minFlickVelocity = 0.28;

    if (offset < -threshold || (velocity < -minFlickVelocity && offset < -20)) {
      return Math.min(active + 1, total - 1);
    }
    if (offset > threshold || (velocity > minFlickVelocity && offset > 20)) {
      return Math.max(active - 1, 0);
    }
    return active;
  }

  function isInteractiveElement(target) {
    if (!target || typeof target.closest !== "function") return false;
    return Boolean(
      target.closest(
        "input, textarea, select, [contenteditable], .no-drag, [data-no-drag], .tabs-container, .folder-tabs-row, .slider, input[type='range'], .edit-toolbar, .star-badge, .remove-badge, .modal, .dialog"
      )
    );
  }

  function handleTouchStart(e) {
    if (e.touches.length !== 1) {
      isTouchTracking = false;
      return;
    }
    if (!canDrag()) {
      isTouchTracking = false;
      return;
    }
    if (isInteractiveElement(e.target)) {
      isTouchTracking = false;
      return;
    }

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isTouchTracking = true;
    isDragEngaged = false;
    const now = Date.now();
    touchHistory = [{ x: touchStartX, time: now }];
    onPrepare();
  }

  function handleTouchMove(e) {
    if (!isTouchTracking || e.touches.length !== 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartX;
    const diffY = currentY - touchStartY;

    if (!isDragEngaged) {
      if (Math.abs(diffY) > 8 && Math.abs(diffY) >= Math.abs(diffX)) {
        isTouchTracking = false;
        return;
      }
      if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY) * 1.15) {
        isDragEngaged = true;
        onDragStart();
      } else {
        return;
      }
    }

    if (isDragEngaged) {
      if (e.cancelable) e.preventDefault();
      const active = getActive();
      const total = getPagesCount();
      const offset = calculateOffset(diffX, active, total);
      const now = Date.now();
      touchHistory.push({ x: currentX, time: now });
      if (touchHistory.length > 5) touchHistory.shift();
      onDragMove(offset);
    }
  }

  function handleTouchEnd() {
    if (!isTouchTracking) return;
    isTouchTracking = false;
    if (!isDragEngaged) return;
    isDragEngaged = false;

    const active = getActive();
    const total = getPagesCount();
    const width = node.offsetWidth || window.innerWidth;
    const lastHistory = touchHistory[touchHistory.length - 1];
    const diffX = (lastHistory ? lastHistory.x : touchStartX) - touchStartX;
    const offset = calculateOffset(diffX, active, total);
    const velocity = computeVelocity(touchHistory);
    const target = resolveTarget(offset, velocity, active, total, width);

    onDragEnd(target, offset, width);
  }

  function handleTouchCancel() {
    if (!isTouchTracking) return;
    isTouchTracking = false;
    if (!isDragEngaged) return;
    isDragEngaged = false;

    const active = getActive();
    const width = node.offsetWidth || window.innerWidth;
    onDragEnd(active, 0, width);
  }

  function handleMouseDown(e) {
    if (e.button !== 0) return;
    if (!canDrag()) return;
    if (isInteractiveElement(e.target)) return;
    if (e.target.closest("button, a")) return;

    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    isMouseTracking = true;
    isMouseEngaged = false;
    const now = Date.now();
    mouseHistory = [{ x: mouseStartX, time: now }];
    onPrepare();

    const onMouseMove = (moveEv) => {
      if (!isMouseTracking) return;
      const currentX = moveEv.clientX;
      const currentY = moveEv.clientY;
      const diffX = currentX - mouseStartX;
      const diffY = currentY - mouseStartY;

      if (!isMouseEngaged) {
        if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY) * 1.15) {
          isMouseEngaged = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
          onDragStart();
        } else if (Math.abs(diffY) > 8) {
          cleanupMouseListeners();
          isMouseTracking = false;
          return;
        } else {
          return;
        }
      }

      if (isMouseEngaged) {
        moveEv.preventDefault();
        const active = getActive();
        const total = getPagesCount();
        const offset = calculateOffset(diffX, active, total);
        const timeNow = Date.now();
        mouseHistory.push({ x: currentX, time: timeNow });
        if (mouseHistory.length > 5) mouseHistory.shift();
        onDragMove(offset);
      }
    };

    const onMouseUp = () => {
      cleanupMouseListeners();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      if (!isMouseTracking) return;
      isMouseTracking = false;

      if (!isMouseEngaged) return;
      isMouseEngaged = false;

      const suppressClick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", suppressClick, { capture: true, once: true });
      setTimeout(() => {
        window.removeEventListener("click", suppressClick, { capture: true });
      }, 100);

      const active = getActive();
      const total = getPagesCount();
      const width = node.offsetWidth || window.innerWidth;
      const lastHistory = mouseHistory[mouseHistory.length - 1];
      const diffX = (lastHistory ? lastHistory.x : mouseStartX) - mouseStartX;
      const offset = calculateOffset(diffX, active, total);
      const velocity = computeVelocity(mouseHistory);
      const target = resolveTarget(offset, velocity, active, total, width);

      onDragEnd(target, offset, width);
    };

    activeMouseMove = onMouseMove;
    activeMouseUp = onMouseUp;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function cleanupMouseListeners() {
    if (activeMouseMove) {
      window.removeEventListener("mousemove", activeMouseMove);
      activeMouseMove = null;
    }
    if (activeMouseUp) {
      window.removeEventListener("mouseup", activeMouseUp);
      activeMouseUp = null;
    }
  }

  node.addEventListener("touchstart", handleTouchStart, { passive: true });
  node.addEventListener("touchmove", handleTouchMove, { passive: false });
  node.addEventListener("touchend", handleTouchEnd);
  node.addEventListener("touchcancel", handleTouchCancel);
  node.addEventListener("mousedown", handleMouseDown);

  return {
    update(newOptions) {
      getPagesCount = newOptions.getPagesCount || (() => 0);
      getActive = newOptions.getActive || (() => 0);
      canDrag = newOptions.canDrag || (() => true);
      onPrepare = newOptions.onPrepare || (() => {});
      onDragStart = newOptions.onDragStart || (() => {});
      onDragMove = newOptions.onDragMove || (() => {});
      onDragEnd = newOptions.onDragEnd || (() => {});
    },
    destroy() {
      cleanupMouseListeners();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchCancel);
      node.removeEventListener("mousedown", handleMouseDown);
    },
  };
}
