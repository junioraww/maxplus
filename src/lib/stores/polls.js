import { writable, get } from "svelte/store";
import API from "$lib/stores/api";

export const pollsStore = writable({});

const inFlight = new Set();

export function updatePollInStore(pollId, pollData) {
  if (!pollId || !pollData) return;
  pollsStore.update((curr) => {
    const existing = curr[pollId] || {};
    return {
      ...curr,
      [pollId]: {
        ...existing,
        ...pollData,
        state: pollData.state || existing.state || { total: 0, result: [] },
      },
    };
  });
}

export function updatePollState(pollId, state) {
  if (!pollId || !state) return;
  pollsStore.update((curr) => {
    const existing = curr[pollId];
    if (!existing) return curr;
    return {
      ...curr,
      [pollId]: {
        ...existing,
        state: {
          ...existing.state,
          ...state,
        },
      },
    };
  });
}

export async function fetchPollUpdates(chatId, messageId, pollId, force = false) {
  const idNum = Number(pollId);
  if (!idNum || (!force && inFlight.has(idNum))) return;

  const current = get(pollsStore)[idNum];
  if (!force && current?.state?.result?.length) return;

  inFlight.add(idNum);
  try {
    const api = get(API);
    const res = await api.getPollUpdates(chatId, messageId, idNum);
    const polls = res?.polls || res?.items || (Array.isArray(res) ? res : []);
    for (const p of polls) {
      const pid = p.pollId || p.id;
      if (pid) {
        updatePollInStore(pid, p);
      }
    }
  } catch (e) {
  } finally {
    inFlight.delete(idNum);
  }
}

export async function castPollVote(chatId, messageId, pollId, answerIds) {
  const idNum = Number(pollId);
  try {
    const api = get(API);
    const res = await api.votePoll(chatId, messageId, idNum, answerIds);
    if (res?.state) {
      updatePollState(idNum, res.state);
    } else {
      await fetchPollUpdates(chatId, messageId, idNum, true);
    }
    return { ok: true, state: res?.state };
  } catch (e) {
    return { ok: false, error: e };
  }
}
