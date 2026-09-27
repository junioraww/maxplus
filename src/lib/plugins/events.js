const listeners = new Map();

export function pluginOn(event, cb) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(cb);
}

export function pluginOff(event, cb) {
  if (!listeners.has(event)) return;
  listeners.set(event, listeners.get(event).filter(h => h !== cb));
}

export function pluginEmit(event, data) {
  const handlers = listeners.get(event);
  if (!handlers) return;
  for (const handler of handlers) {
    try { handler(data); } catch (e) { console.error(`[plugin-events] handler error for "${event}":`, e); }
  }
}
