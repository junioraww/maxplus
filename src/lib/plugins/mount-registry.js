import { writable, get } from 'svelte/store';

const registry = writable(new Map());

let handleCounter = 0;

export { registry as mountedContent };

export function registerMount(mountPoint, item) {
  const handle = { id: ++handleCounter, mountPoint, ...item };
  registry.update(map => {
    const next = new Map(map);
    const list = next.get(mountPoint) ? [...next.get(mountPoint)] : [];
    list.push(handle);
    next.set(mountPoint, list);
    return next;
  });
  return handle;
}

export function unregisterMount(handle) {
  if (!handle) return;
  registry.update(map => {
    const next = new Map(map);
    const list = next.get(handle.mountPoint);
    if (list) {
      next.set(handle.mountPoint, list.filter(h => h.id !== handle.id));
    }
    return next;
  });
}

export function getMountItems(mountPoint) {
  return get(registry).get(mountPoint) || [];
}

export function getMountStore(mountPoint) {
  return {
    subscribe(cb) {
      return registry.subscribe(map => cb(map.get(mountPoint) || []));
    }
  };
}
