import { get } from "svelte/store";
import { batchDecrypt } from "$lib/crypto/messages.js";
import { getCurrentAccount } from "$lib/stores/accounts.js";
import { checkForEncryptionRequest } from "$components/ChatWindow/e2e.js";
import { computeTextDiff } from "$lib/utils/diff.js";
import { get as sessionGet } from "$lib/stores/session";

export const BATCH_SIZE = 40;

export function createMessagesLoader({
  messages,
  decodedMessages,
  getChatObj,
  getChatId,
  getChatSettings,
  getChatCache,
  getApi,
  onAnchorCapture = () => {},
  onAnchorRestore = () => {},
  onSecretChatRequest = () => {},
}) {
  let loading = false;
  let all_loaded = false;
  let loadingNewer = false;
  let all_loaded_newer = true;
  let initialized = false;

  const checkedPlaintextIds = new Set();

  async function decodeMessagesBatch(list) {
    if (!list || !list.length) return;
    try {
      const currentDecoded = get(decodedMessages);
      const toDecode = list.filter((m) => {
        const idStr = String(m.id);
        if (checkedPlaintextIds.has(idStr) && !m.edited && m.status !== "EDITED") return false;
        const existing = currentDecoded[idStr];
        if (!existing) return true;
        if (m.edited || m.status === "EDITED") return true;
        return false;
      });

      if (!toDecode.length) return;

      const account = await getCurrentAccount();
      const settingsStore = getChatSettings();
      const password = (settingsStore ? get(settingsStore)?.password : null) || null;
      const currentChatId = getChatObj()?.id ?? getChatId();
      const updates = await batchDecrypt(
        Number(account?.id || 0),
        Number(currentChatId),
        toDecode,
        password
      );

      for (const m of toDecode) {
        const idStr = String(m.id);
        if (!updates || !updates[idStr]) {
          checkedPlaintextIds.add(idStr);
        } else {
          checkedPlaintextIds.delete(idStr);
        }
      }

      decodedMessages.update((old) => ({
        ...old,
        ...updates,
      }));

      const newReq = await checkForEncryptionRequest(getChatObj(), settingsStore, updates, toDecode);
      if (newReq) {
        onSecretChatRequest(newReq);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function mergeMessages(incoming, updateCache = false) {
    if (!incoming?.length) return;

    const map = new Map(
      get(messages).map((m) => [String(m.id), m])
    );

    const changed = [];

    for (const msg of incoming) {
      const msgId = String(msg.id);
      const old = map.get(msgId);

      if (!old) {
        const isEdited = msg.status === "EDITED" || !!msg.edited;
        const entry = {
          ...msg,
          id: msgId,
          ...(isEdited ? { edited: true } : {}),
        };
        map.set(msgId, entry);
        changed.push(entry);
        continue;
      }

      const isEditedStatus = msg.status === "EDITED" || old.status === "EDITED" || old.edited || msg.edited;
      const isDeletedStatus = old.deleted || msg.deleted || msg.status === "REMOVED";

      let newHistory = Array.isArray(old.history) ? [...old.history] : [];
      if (Array.isArray(msg.history)) {
        for (const h of msg.history) {
          if (!newHistory.some((existing) => existing.at === h.at)) {
            newHistory.push(h);
          }
        }
      }

      const textChanged = old.text && msg.text && old.text !== msg.text;
      if (textChanged && (!Array.isArray(msg.history) || !msg.history.length)) {
        const textDiff = computeTextDiff(old.text, msg.text);
        const at = msg.editTime || msg.edited_at || Date.now();
        newHistory.push({ at, diff: textDiff });
      }

      const merged = {
        ...old,
        ...msg,
        id: msgId,
        ...(isDeletedStatus ? { deleted: true, deleted_at: old.deleted_at || msg.deleted_at || Date.now() } : {}),
        ...(isEditedStatus ? { edited: true, edited_at: old.edited_at || msg.edited_at || msg.editTime || Date.now() } : {}),
        ...(newHistory.length ? { history: newHistory } : {}),
      };

      if (JSON.stringify(old) !== JSON.stringify(merged)) {
        map.set(msgId, merged);
        changed.push(merged);
      }
    }

    if (!changed.length) return;

    messages.set(
      [...map.values()].sort((a, b) => a.time - b.time)
    );

    if (updateCache) {
      getChatCache()?.updateMessages(changed);
    }

    await decodeMessagesBatch(changed);
  }

  async function loadHistory(
    isInitial = false,
    from = Date.now() + sessionGet("drift"),
    backward = BATCH_SIZE,
    forward = 0
  ) {
    const currentChatId = getChatObj()?.id ?? getChatId();
    if (loading) return;
    if (all_loaded && !isInitial) return;
    if (currentChatId == null) return;

    loading = true;

    try {
      const chatCache = getChatCache();
      const cached = await chatCache?.loadMessages(from, backward);

      onAnchorCapture();
      if (cached) {
        await mergeMessages(cached, false);
      }
      onAnchorRestore();
      onAnchorCapture();

      const api = getApi();
      if (!initialized || isInitial) {
        const { error, messages: serverMessages } = await api.getMessages(currentChatId, from, backward, forward);
        if (error) throw new Error(error);

        await mergeMessages(serverMessages, true);

        if (serverMessages.length < backward + forward) {
          if (forward === 0) {
            all_loaded = true;
          }
        }
        initialized = true;
      } else {
        const oldest = get(messages)[0];
        const { error, messages: olderMessages } = await api.getMessages(
          currentChatId,
          oldest?.time ?? from,
          backward,
          forward
        );
        if (error) throw new Error(error);

        if (olderMessages.length < backward) {
          all_loaded = true;
        }

        await mergeMessages(olderMessages, true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      onAnchorRestore();
      loading = false;
    }

    onAnchorRestore();
  }

  async function loadNewer() {
    const currentChatId = getChatObj()?.id ?? getChatId();
    if (loadingNewer || all_loaded_newer) return;
    if (currentChatId == null) return;

    loadingNewer = true;

    try {
      const msgs = get(messages);
      const newest = msgs[msgs.length - 1];
      const fromTime = newest?.time ?? (Date.now() + sessionGet("drift"));

      const api = getApi();
      const { error, messages: newerMessages } = await api.getNewerMessages(currentChatId, fromTime, BATCH_SIZE);
      if (error) throw new Error(error);

      if (!newerMessages || newerMessages.length < BATCH_SIZE) {
        all_loaded_newer = true;
      }

      await mergeMessages(newerMessages, false);
    } catch (e) {
      console.error(e);
    } finally {
      loadingNewer = false;
    }

    onAnchorRestore();
  }

  return {
    get loading() { return loading; },
    get all_loaded() { return all_loaded; },
    set all_loaded(v) { all_loaded = v; },
    get loadingNewer() { return loadingNewer; },
    get all_loaded_newer() { return all_loaded_newer; },
    set all_loaded_newer(v) { all_loaded_newer = v; },
    decodeMessagesBatch,
    mergeMessages,
    loadHistory,
    loadNewer,
  };
}
