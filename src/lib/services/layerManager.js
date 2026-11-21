import { writable, derived, get } from "svelte/store";

let layerCounter = 0;

export const layerStack = writable([]);

export const hasActiveLayers = derived(
  layerStack,
  ($stack) => $stack.some((l) => !l.isClosing)
);

export function openLayer(component, type, props = {}, options = {}) {
  let recordId = null;
  const promise = new Promise((resolve, reject) => {
    const id = `layer_${Date.now()}_${++layerCounter}`;
    recordId = id;
    const record = {
      id,
      component,
      props,
      type,
      options: {
        dismissOnDim: options.dismissOnDim ?? (type !== "screen"),
        dim: options.dim ?? (type !== "screen"),
        dimOpacity: options.dimOpacity ?? (type === "dropout" ? 0.35 : 0.65),
        coords: options.coords || null,
        onClose: options.onClose || null,
        onBack: options.onBack || null,
        canSwipe: options.canSwipe ?? (type === "screen" || type === "sheet"),
        transparent: Boolean(options.transparent),
        noAnimation: Boolean(options.noAnimation),
        closeDelay: options.closeDelay ?? (options.noAnimation ? 200 : (type === "screen" ? 280 : type === "sheet" ? 250 : 200)),
        ...options,
      },
      isClosing: false,
      resolve,
      reject,
      customBackHandler: null,
    };

    layerStack.update((stack) => [...stack, record]);
  });
  promise.id = recordId;
  return promise;
}

export function openScreen(component, props = {}, options = {}) {
  return openLayer(component, "screen", props, {
    dim: false,
    dismissOnDim: false,
    ...options,
  });
}

export function openDrawer(component, props = {}, options = {}) {
  return openLayer(component, "drawer", props, {
    dim: true,
    dimOpacity: 0.65,
    dismissOnDim: true,
    canSwipe: true,
    closeDelay: 195,
    ...options,
  });
}

export function openSheet(component, props = {}, options = {}) {
  return openLayer(component, "sheet", props, {
    dim: true,
    dimOpacity: 0.65,
    dismissOnDim: true,
    ...options,
  });
}

export function openDialog(component, props = {}, options = {}) {
  return openLayer(component, "dialog", props, {
    dim: true,
    dimOpacity: 0.65,
    dismissOnDim: true,
    ...options,
  });
}

export function openDropout(component, props = {}, options = {}) {
  return openLayer(component, "dropout", props, {
    dim: true,
    dimOpacity: 0.35,
    dismissOnDim: true,
    ...options,
  });
}

export function openViewer(component, props = {}, options = {}) {
  return openLayer(component, "viewer", props, {
    dim: false,
    dismissOnDim: false,
    canSwipe: false,
    closeDelay: 180,
    ...options,
  });
}

export function dismissLayer(id, result) {
  let target = null;
  layerStack.update((stack) => {
    return stack.map((layer) => {
      if (layer.id === id && !layer.isClosing) {
        target = { ...layer, isClosing: true, result };
        return target;
      }
      return layer;
    });
  });

  if (target) {
    const duration = target.options?.closeDelay ?? (
      target.type === "screen" ? 195 :
      target.type === "drawer" ? 195 :
      target.type === "sheet" ? 185 :
      target.type === "viewer" ? 180 :
      160
    );
    setTimeout(() => {
      finalizeLayer(id, result);
    }, duration);
  }
}

export function finalizeLayer(id, result) {
  let finished = null;
  layerStack.update((stack) => {
    const index = stack.findIndex((l) => l.id === id);
    if (index !== -1) {
      finished = stack[index];
      return [...stack.slice(0, index), ...stack.slice(index + 1)];
    }
    return stack;
  });

  if (finished) {
    if (typeof finished.options?.onClose === "function") {
      try {
        finished.options.onClose(result);
      } catch (e) {
        console.error(e);
      }
    }
    if (typeof finished.resolve === "function") {
      finished.resolve(result);
    }
  }
}

export function closeLayer(id, result) {
  dismissLayer(id, result);
}

export function closeTopLayer(result) {
  const current = get(layerStack);
  const active = current.filter((l) => !l.isClosing);
  if (active.length > 0) {
    dismissLayer(active[active.length - 1].id, result);
  }
}

export function popToRoot() {
  const current = get(layerStack);
  for (const layer of current) {
    if (!layer.isClosing) {
      dismissLayer(layer.id);
    }
  }
}

export function setLayerBackHandler(id, handler) {
  layerStack.update((stack) =>
    stack.map((l) => (l.id === id ? { ...l, customBackHandler: handler } : l))
  );
}
