export function swipeToClose(node, options = {}) {
  let { canSwipe = () => true, onClose = () => {}, onStateChange = () => {} } = options;

  let touchStartX = 0;
  let touchStartY = 0;
  let currentDragX = 0;
  let isTouchTracking = false;
  let isSwipingChat = false;
  let isScrollingChat = false;
  let isClosingBySwipe = false;
  let chatWindowWidth = 0;

  let isMouseDragging = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseDragEngaged = false;
  let activeMouseMove = null;
  let activeMouseUp = null;

  function emitState() {
    onStateChange({
      currentDragX,
      isSwipingChat,
      isClosingBySwipe,
    });
  }

  function handleTouchStart(e) {
    if (e.touches.length !== 1) {
      isTouchTracking = false;
      return;
    }
    if (!canSwipe() || isClosingBySwipe) {
      isTouchTracking = false;
      return;
    }
    if (e.target.closest("input, textarea, button, a, .icon-button, .scroll-down-container, .media-playback-header, .timeline-track-container, .speed-control-wrapper, .volume-control-wrapper, .hdr-btn")) {
      isTouchTracking = false;
      return;
    }

    isTouchTracking = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    currentDragX = 0;
    isSwipingChat = false;
    isScrollingChat = false;
    chatWindowWidth = window.innerWidth;
    emitState();
  }

  function handleTouchMove(e) {
    if (!isTouchTracking || isScrollingChat || isClosingBySwipe) return;
    if (e.touches.length !== 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartX;
    const diffY = currentY - touchStartY;

    if (!isSwipingChat) {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        if (diffX > 10 && diffX > Math.abs(diffY) * 1.1) {
          isSwipingChat = true;
        } else {
          isScrollingChat = true;
          return;
        }
      } else {
        return;
      }
    }

    if (isSwipingChat) {
      currentDragX = diffX > 0 ? diffX : 0;
      if (e.cancelable) e.preventDefault();
      emitState();
    }
  }

  function handleTouchEnd() {
    isTouchTracking = false;
    if (!isSwipingChat || isClosingBySwipe) {
      isSwipingChat = false;
      isScrollingChat = false;
      emitState();
      return;
    }

    const threshold = chatWindowWidth * 0.3;
    if (currentDragX >= threshold) {
      isClosingBySwipe = true;
      isSwipingChat = false;
      currentDragX = chatWindowWidth;
      emitState();
      setTimeout(() => {
        onClose();
      }, 220);
    } else {
      isSwipingChat = false;
      currentDragX = 0;
      isScrollingChat = false;
      emitState();
    }
  }

  function handleTouchCancel() {
    isTouchTracking = false;
    if (!isClosingBySwipe) {
      isSwipingChat = false;
      isScrollingChat = false;
      currentDragX = 0;
      emitState();
    }
  }

  function handleMouseDown(e) {
    if (isClosingBySwipe || !canSwipe()) return;
    if (e.button !== 0) return;
    if (e.target.closest("input, textarea, button, a, .icon-button, .scroll-down-container, .media-playback-header, .timeline-track-container, .speed-control-wrapper, .volume-control-wrapper")) return;

    const isHeader = Boolean(e.target.closest("header"));
    const isLeftEdge = e.clientX <= 60;
    const isMessage = Boolean(e.target.closest(".message, .bubble"));

    if (!isHeader && !isLeftEdge && isMessage) {
      return;
    }

    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    isMouseDragging = true;
    mouseDragEngaged = false;
    chatWindowWidth = window.innerWidth;

    const onMouseMove = (moveEv) => {
      if (!isMouseDragging) return;
      const diffX = moveEv.clientX - mouseStartX;
      const diffY = moveEv.clientY - mouseStartY;

      if (!mouseDragEngaged) {
        if (diffX > 10 && diffX > Math.abs(diffY) * 1.1) {
          mouseDragEngaged = true;
          isSwipingChat = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        } else if (Math.abs(diffY) > 10) {
          isMouseDragging = false;
          cleanupMouseListeners();
          return;
        }
      }

      if (mouseDragEngaged) {
        currentDragX = Math.max(0, diffX);
        moveEv.preventDefault();
        emitState();
      }
    };

    const onMouseUp = () => {
      cleanupMouseListeners();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      if (!isMouseDragging) return;
      isMouseDragging = false;

      if (!mouseDragEngaged) {
        isSwipingChat = false;
        currentDragX = 0;
        emitState();
        return;
      }

      const threshold = chatWindowWidth * 0.3;
      if (currentDragX >= threshold) {
        isClosingBySwipe = true;
        isSwipingChat = false;
        currentDragX = chatWindowWidth;
        emitState();
        setTimeout(() => {
          onClose();
        }, 220);
      } else {
        isSwipingChat = false;
        currentDragX = 0;
        emitState();
      }
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
      canSwipe = newOptions.canSwipe || (() => true);
      onClose = newOptions.onClose || (() => {});
      onStateChange = newOptions.onStateChange || (() => {});
    },
    destroy() {
      cleanupMouseListeners();
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchCancel);
      node.removeEventListener("mousedown", handleMouseDown);
    },
  };
}
