import { invoke as rawInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const incomingHooks = [];
const outgoingHooks = [];
let hookListenerPromise = null;

function syncIncomingHooksToRust() {
  if (typeof window === "undefined") return;
  const opcodes = Array.from(
    new Set(
      incomingHooks
        .filter((h) => Number.isFinite(h.opcode) && h.opcode > 0)
        .map((h) => h.opcode)
    )
  );
  rawInvoke("register_plugin_opcode_hooks", { opcodes }).catch(() => {});
}

export function ensureOpcodeHookListener() {
  if (typeof window === "undefined" || hookListenerPromise) return hookListenerPromise;
  hookListenerPromise = listen("max:opcode-hook", async (event) => {
    const { hookId, opcode, payload } = event?.payload || {};
    if (!hookId) return;

    const matching = incomingHooks.filter((h) => h.opcode === opcode || h.opcode === "*");
    if (matching.length === 0) {
      rawInvoke("resolve_opcode_hook", { hookId, action: "continue", payload: null }).catch(() => {});
      return;
    }

    const ctx = {
      direction: "in",
      opcode,
      payload,
      reply(replyOpcode, replyPayload = {}) {
        return rawInvoke("call_opcode", {
          opcode: Number(replyOpcode),
          payload: replyPayload,
        });
      },
    };

    let idx = -1;
    let passedThrough = false;

    async function dispatch(i) {
      if (i <= idx) {
        throw new Error("next() called multiple times");
      }
      idx = i;
      if (i >= matching.length) {
        passedThrough = true;
        return ctx.payload;
      }
      const fn = matching[i].handler;
      return await fn(ctx, () => dispatch(i + 1));
    }

    try {
      await dispatch(0);
      await rawInvoke("resolve_opcode_hook", {
        hookId,
        action: passedThrough ? "continue" : "drop",
        payload: passedThrough ? ctx.payload : null,
      });
    } catch (err) {
      console.error("[plugin-opcode-hook] middleware error:", err);
      rawInvoke("resolve_opcode_hook", { hookId, action: "continue", payload: null }).catch(() => {});
    }
  });
  return hookListenerPromise;
}

export function registerIncomingOpcodeHook(pluginId, opcodeOrList, handler) {
  if (typeof handler !== "function") {
    throw new Error("Middleware handler must be a function");
  }
  const list = Array.isArray(opcodeOrList) ? opcodeOrList : [opcodeOrList];
  for (const op of list) {
    const normalized = op === "*" ? "*" : Number(op);
    if (normalized !== "*" && !Number.isFinite(normalized)) continue;
    incomingHooks.push({ pluginId, opcode: normalized, handler });
  }
  ensureOpcodeHookListener();
  syncIncomingHooksToRust();
}

export function registerOutgoingCommandHook(pluginId, target, handler) {
  if (typeof handler !== "function") {
    throw new Error("Middleware handler must be a function");
  }
  const list = Array.isArray(target) ? target : [target];
  for (const item of list) {
    outgoingHooks.push({ pluginId, target: item, handler });
  }
}

export function unregisterPluginOpcodeHooks(pluginId) {
  let incomingChanged = false;
  for (let i = incomingHooks.length - 1; i >= 0; i--) {
    if (incomingHooks[i].pluginId === pluginId) {
      incomingHooks.splice(i, 1);
      incomingChanged = true;
    }
  }
  for (let i = outgoingHooks.length - 1; i >= 0; i--) {
    if (outgoingHooks[i].pluginId === pluginId) {
      outgoingHooks.splice(i, 1);
    }
  }
  if (incomingChanged) {
    syncIncomingHooksToRust();
  }
}

export async function runOutgoingMiddleware(command, args, executor) {
  if (outgoingHooks.length === 0) {
    return executor(command, args);
  }
  const opcode = command === "call_opcode" ? Number(args?.opcode) : null;
  const matching = outgoingHooks.filter(
    (h) => h.target === "*" || h.target === command || (opcode !== null && h.target === opcode)
  );
  if (matching.length === 0) {
    return executor(command, args);
  }

  const ctx = {
    direction: "out",
    command,
    opcode,
    args: args ? { ...args } : {},
    payload: command === "call_opcode" ? args?.payload : args,
    reply(replyOpcode, replyPayload = {}) {
      return rawInvoke("call_opcode", {
        opcode: Number(replyOpcode),
        payload: replyPayload,
      });
    },
  };

  let idx = -1;
  async function dispatch(i) {
    if (i <= idx) {
      throw new Error("next() called multiple times");
    }
    idx = i;
    if (i >= matching.length) {
      const nextArgs =
        ctx.command === "call_opcode" && ctx.payload !== args?.payload
          ? { ...ctx.args, payload: ctx.payload }
          : ctx.args;
      return await executor(ctx.command, nextArgs);
    }
    return await matching[i].handler(ctx, () => dispatch(i + 1));
  }

  return await dispatch(0);
}
