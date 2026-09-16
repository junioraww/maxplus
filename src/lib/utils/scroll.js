export function scrollTo(element, target, options = {}) {
  if (!element) return Promise.resolve();

  const { smooth = false, offset = 0, onComplete } = options;

  return new Promise((resolve) => {
    const done = () => {
      onComplete?.();
      resolve();
    };

    let targetY;
    if (typeof target === 'number') {
      targetY = target;
    } else if (target === 'bottom') {
      targetY = element.scrollHeight - element.clientHeight;
    } else if (target instanceof Element) {
      const containerRect = element.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      targetY = element.scrollTop + (targetRect.top - containerRect.top) - offset - element.clientHeight / 4;
    } else {
      done();
      return;
    }

    const maxY = element.scrollHeight - element.clientHeight;
    targetY = Math.max(0, Math.min(targetY, maxY));

    const forceTo = (y) => {
      element.scrollTop = Math.ceil(y);
      if (element.scrollTop < y) {
        element.scrollTop = 999999;
      }
      done();
    };

    if (!smooth) {
      forceTo(targetY);
    } else {
      const startY = element.scrollTop;
      const distance = targetY - startY;
      if (Math.abs(distance) < 1) {
        forceTo(targetY);
        return;
      }

      const duration = 300;
      let startTime = null;

      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        element.scrollTop = startY + distance * ease;

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          forceTo(targetY);
        }
      }

      requestAnimationFrame(step);
    }
  });
}

export function scrollToBottom(element, smooth = false) {
  return scrollTo(element, 'bottom', { smooth });
}
