<script>
  import { onDestroy, onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { pollsStore, fetchPollUpdates, castPollVote, updatePollInStore } from "$lib/stores/polls";
  import { currentUser } from "$lib/stores/api";
  import { showAlert } from "$lib/utils/alert";
  import PollVotersModal from "$components/ChatWindow/PollVotersModal.svelte";

  export let attach;
  export let messageId;
  export let chatId;
  export let isMe = false;

  const POLL_FLAG_ANONYMOUS = 4;
  const POLL_FLAG_CLOSED = 8;

  let canvasEl;
  let isSubmitting = false;
  let showExportMenu = false;
  let showVotersModal = false;
  let selectedVotersAnswer = null;

  let optimisticVotedIds = new Set();
  let pendingVoteIds = null;
  let voteTimer = null;
  let wasVotedBeforePending = false;
  let isCancelledPendingVote = false;

  $: pollId = Number(attach?.pollId || attach?.id || 0);
  $: rawStorePoll = $pollsStore[pollId];
  $: poll = rawStorePoll || attach;

  $: title = poll?.title || attach?.title || "Опрос";
  $: answers = poll?.answers || attach?.answers || [];
  $: settings = Number(poll?.settings ?? attach?.settings ?? 0);
  $: isAnonymous = Boolean(poll?.anonymous || (settings & POLL_FLAG_ANONYMOUS) !== 0);
  $: isClosed = (settings & POLL_FLAG_CLOSED) !== 0;

  $: state = poll?.state || {};
  $: serverTotal = Number(state?.total || 0);
  $: serverResults = state?.result || [];
  $: serverResultMap = new Map(serverResults.map((r) => [Number(r.answerId), r]));

  $: serverVotedAnswerIds = new Set(
    answers.map((a) => Number(a.answerId ?? a.id ?? 0)).filter((id) => {
      const res = serverResultMap.get(id);
      if (!res) return false;
      if ((res.options & 1) !== 0) return true;
      const myId = Number($currentUser);
      return Boolean(myId && Array.isArray(res.votes) && res.votes.some((v) => Number(v.userId || v.user_id) === myId));
    })
  );

  $: activeVotedIds = isCancelledPendingVote ? new Set() : (optimisticVotedIds.size > 0 ? optimisticVotedIds : (pendingVoteIds ? new Set() : (wasVotedBeforePending ? new Set() : serverVotedAnswerIds)));
  $: hasVoted = isCancelledPendingVote ? false : (activeVotedIds.size > 0 || (isPending && wasVotedBeforePending));
  $: showResults = hasVoted || isClosed;
  $: isPending = Boolean(pendingVoteIds && pendingVoteIds.length > 0);

  $: totalVotes = (() => {
    if (isCancelledPendingVote) {
      return Math.max(0, serverTotal - (serverVotedAnswerIds.size > 0 ? 1 : 0));
    }
    if (serverVotedAnswerIds.size === 0 && optimisticVotedIds.size > 0) {
      return serverTotal + 1;
    }
    return serverTotal;
  })();

  $: resultMap = (() => {
    const map = new Map();
    const myId = Number($currentUser);
    const nowSec = Math.floor(Date.now() / 1000);
    for (const ans of answers) {
      const aid = Number(ans.answerId ?? ans.id ?? 0);
      const sRes = serverResultMap.get(aid);
      let voteCount = Number(sRes?.voteCount || 0);
      let votes = Array.isArray(sRes?.votes) ? [...sRes.votes] : [];
      let options = Number(sRes?.options || 0);

      const isServerVoted = serverVotedAnswerIds.has(aid);
      const isOptimisticVoted = isCancelledPendingVote ? false : optimisticVotedIds.has(aid);

      if (isCancelledPendingVote) {
        if (isServerVoted) {
          voteCount = Math.max(0, voteCount - 1);
          options &= ~1;
          if (myId) {
            votes = votes.filter((v) => Number(v.userId || v.user_id) !== myId);
          }
        }
      } else if (optimisticVotedIds.size > 0) {
        if (isServerVoted && !isOptimisticVoted) {
          voteCount = Math.max(0, voteCount - 1);
          options &= ~1;
          if (myId) {
            votes = votes.filter((v) => Number(v.userId || v.user_id) !== myId);
          }
        } else if (!isServerVoted && isOptimisticVoted) {
          voteCount += 1;
          options |= 1;
          if (myId && !votes.some((v) => Number(v.userId || v.user_id) === myId)) {
            votes = [{ userId: myId, timestamp: nowSec }, ...votes];
          }
        }
      }

      map.set(aid, { answerId: aid, voteCount, votes, options, rate: sRes?.rate || 0 });
    }
    return map;
  })();

  onMount(() => {
    if (pollId && attach) {
      updatePollInStore(pollId, attach);
      fetchPollUpdates(chatId, messageId, pollId);
    }
  });

  onDestroy(() => {
    if (voteTimer && pendingVoteIds) {
      clearTimeout(voteTimer);
      const ids = pendingVoteIds;
      pendingVoteIds = null;
      voteTimer = null;
      submitVote(ids);
    }
  });

  function slideOutRight(node, { duration = 200 }) {
    return {
      duration,
      css: (t, u) => `
        opacity: ${t};
        overflow: hidden;
      `,
    };
  }

  function handleOptionSelect(aid, e) {
    if (isSubmitting || isClosed || showResults) return;
    triggerVote(aid, e);
  }

  function getEventCoords(e) {
    if (!canvasEl) return null;
    const clientX = e?.clientX ?? e?.touches?.[0]?.clientX ?? e?.changedTouches?.[0]?.clientX;
    const clientY = e?.clientY ?? e?.touches?.[0]?.clientY ?? e?.changedTouches?.[0]?.clientY;
    if (clientX == null || clientY == null) return null;
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function triggerVote(aid, e) {
    if (isSubmitting || isClosed) return;
    isCancelledPendingVote = false;
    wasVotedBeforePending = hasVoted;
    pendingVoteIds = [aid];
    optimisticVotedIds = new Set([aid]);
    launchConfetti(getEventCoords(e));

    if (voteTimer) clearTimeout(voteTimer);

    voteTimer = setTimeout(async () => {
      const idsToSend = pendingVoteIds;
      pendingVoteIds = null;
      voteTimer = null;
      wasVotedBeforePending = false;
      if (idsToSend) {
        await submitVote(idsToSend);
      }
    }, 5000);
  }

  function changeVote(newAid, e) {
    if (isSubmitting || isClosed || !isPending) return;
    if (activeVotedIds.has(newAid)) return;

    if (voteTimer) clearTimeout(voteTimer);
    isCancelledPendingVote = false;
    pendingVoteIds = [newAid];
    optimisticVotedIds = new Set([newAid]);
    launchConfetti(getEventCoords(e));

    voteTimer = setTimeout(async () => {
      const idsToSend = pendingVoteIds;
      pendingVoteIds = null;
      voteTimer = null;
      wasVotedBeforePending = false;
      if (idsToSend) {
        await submitVote(idsToSend);
      }
    }, 5000);
  }

  function cancelPendingVote() {
    if (voteTimer) {
      clearTimeout(voteTimer);
      voteTimer = null;
    }
    pendingVoteIds = null;
    optimisticVotedIds = new Set();
    wasVotedBeforePending = false;
    isCancelledPendingVote = true;
  }

  function handleRowClick(aid, ans) {
    if (isPending) return;
    if (!isAnonymous) {
      openVoters(ans);
    }
  }

  function openVoters(ans) {
    if (isAnonymous) return;
    const aid = Number(ans.answerId ?? ans.id ?? 0);
    const res = resultMap.get(aid);
    selectedVotersAnswer = {
      ...ans,
      answerId: aid,
      voteCount: Number(res?.voteCount || 0),
      votes: res?.votes || [],
    };
    showVotersModal = true;
  }

  function launchConfetti(origin) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    const w = (canvasEl.width = canvasEl.offsetWidth);
    const h = (canvasEl.height = canvasEl.offsetHeight);
    const startX = origin?.x != null ? Math.max(0, Math.min(w, origin.x)) : w / 2;
    const startY = origin?.y != null ? Math.max(0, Math.min(h, origin.y)) : h / 2;
    const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4"];
    const pts = Array.from({ length: 30 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 5 + 2;
      return {
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        c: colors[Math.floor(Math.random() * colors.length)],
        s: Math.random() * 4 + 2,
        a: 1,
      };
    });
    function step() {
      ctx.clearRect(0, 0, w, h);
      let active = false;
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2;
        p.a -= 0.03;
        if (p.a > 0) {
          active = true;
          ctx.globalAlpha = p.a;
          ctx.fillStyle = p.c;
          ctx.fillRect(p.x, p.y, p.s, p.s);
        }
      }
      if (active) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, w, h);
    }
    step();
  }

  async function submitVote(ids) {
    if (isSubmitting || !ids?.length) return;
    isSubmitting = true;
    const res = await castPollVote(chatId, messageId, pollId, ids);
    isSubmitting = false;
    if (!res.ok) {
      showAlert("Не удалось отправить голос");
    }
  }

  function getResultsList() {
    return answers.map((ans) => {
      const aid = Number(ans.answerId ?? ans.id ?? 0);
      const res = resultMap.get(aid);
      const count = Number(res?.voteCount || 0);
      const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      const chosen = activeVotedIds.has(aid);
      return { aid, text: ans.text || "", count, percent, chosen };
    });
  }

  function copyPollSummary() {
    const list = getResultsList();
    let summary = `Опрос: ${title}\n${isAnonymous ? "Анонимный" : "Публичный"} | Голосов: ${totalVotes}\n\n`;
    for (const r of list) {
      summary += `${r.chosen ? "[x]" : "[ ]"} ${r.text}: ${r.percent}% (${r.count})\n`;
    }
    const cleanSummary = summary.trim();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(cleanSummary).then(() => {
        showAlert("Результаты скопированы");
      }).catch(() => {
        fallbackCopy(cleanSummary);
      });
    } else {
      fallbackCopy(cleanSummary);
    }
    showExportMenu = false;
  }

  function fallbackCopy(text) {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      showAlert("Результаты скопированы");
    } catch (_) {
      showAlert("Не удалось скопировать");
    }
  }

  async function exportCsv() {
    const list = getResultsList();
    let csv = "ID ответа,Вариант ответа,Количество голосов,Процент,Мой выбор\n";
    for (const r of list) {
      csv += `${r.aid},"${r.text.replace(/"/g, '""')}",${r.count},${r.percent}%,${r.chosen ? "Да" : "Нет"}\n`;
    }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await save({ defaultPath: `poll_${pollId || "results"}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await invoke("write_file_string", { path, content: csv });
      showAlert("Файл успешно сохранен");
    } catch (_) {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `poll_${pollId || "results"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showAlert("CSV-файл сохранен");
    }
    showExportMenu = false;
  }
</script>

{#if showVotersModal && selectedVotersAnswer}
  <PollVotersModal {chatId} {messageId} {pollId} answer={selectedVotersAnswer} on:close={() => { showVotersModal = false; selectedVotersAnswer = null; }} />
{/if}

{#if showExportMenu}
  <div class="poll-dropout-backdrop" on:click|preventDefault|stopPropagation={() => (showExportMenu = false)} on:pointerdown|preventDefault|stopPropagation={() => (showExportMenu = false)}></div>
{/if}

<div class="poll-container" on:click|stopPropagation>
  <canvas bind:this={canvasEl} class="poll-confetti-canvas"></canvas>

  <div class="poll-header">
    <div class="poll-badge-row">
      <span class="poll-badge">
        {#if isAnonymous}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Анонимный
        {:else}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Открытый
        {/if}
      </span>
      {#if isClosed}
        <span class="poll-badge closed">Завершён</span>
      {/if}
    </div>

    <div class="poll-action-wrap">
      <button class="poll-more-btn" type="button" on:click|stopPropagation={() => (showExportMenu = !showExportMenu)} title="Действия">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {#if showExportMenu}
        <div class="poll-menu-dropdown telegram-dropout-card" transition:fade={{ duration: 120 }}>
          <div class="actions-group">
            <button type="button" class="action-row" on:click={copyPollSummary}>
              <svg viewBox="0 0 24 24" class="action-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
              <span class="action-label">Копировать сводку</span>
            </button>
            <button type="button" class="action-row" on:click={exportCsv}>
              <svg viewBox="0 0 24 24" class="action-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <span class="action-label">Экспорт в CSV</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <div class="poll-title">{title}</div>

  <div class="poll-options">
    {#each answers as ans}
      {@const aid = Number(ans.answerId ?? ans.id ?? 0)}
      {@const res = resultMap.get(aid)}
      {@const count = Number(res?.voteCount || 0)}
      {@const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0}
      {@const isChosen = activeVotedIds.has(aid)}

      <div
        class="poll-option-row"
        class:voted={showResults}
        class:my-choice={isChosen}
        class:clickable={showResults ? (!isPending && !isAnonymous) : (!isSubmitting && !isClosed)}
        on:click|stopPropagation={(e) => {
          if (!showResults) {
            handleOptionSelect(aid, e);
          } else {
            handleRowClick(aid, ans);
          }
        }}
      >
        {#if showResults}
          <div class="poll-progress-fill" style="width: {percent}%"></div>
        {/if}

        <div class="poll-row-content">
          <div class="poll-left-content">
            <div class="poll-indicator-slot">
              {#if isChosen}
                <div class="poll-indicator-wrap chosen" in:fade={{ duration: 150 }}>
                  <svg class="poll-check-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              {:else if !showResults}
                <div class="poll-indicator-wrap unvoted">
                  <div class="poll-indicator"></div>
                </div>
              {:else if isPending && !isClosed}
                <div
                  class="poll-indicator-wrap pending"
                  out:slideOutRight={{ duration: 150 }}
                  on:click|stopPropagation={(e) => changeVote(aid, e)}
                >
                  <div class="poll-indicator"></div>
                </div>
              {/if}
            </div>
            <span class="poll-result-text">{ans.text}</span>
          </div>

          <div class="poll-result-meta">
            {#if showResults}
              {#if !isAnonymous && count > 0}
                <span class="poll-count-chip" on:click|stopPropagation={() => openVoters(ans)} title="Посмотреть проголосовавших">{count}</span>
              {/if}
              <span class="poll-percent">{percent}%</span>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>

  <div class="poll-footer">
    <span>{totalVotes} {totalVotes === 1 ? "голос" : (totalVotes >= 2 && totalVotes <= 4 ? "голоса" : "голосов")}</span>
    {#if isPending}
      <button
        type="button"
        class="poll-cancel-btn"
        transition:fade={{ duration: 150 }}
        on:click|stopPropagation={cancelPendingVote}
      >
        Отменить голос
      </button>
    {/if}
  </div>
</div>

<style>
  .poll-dropout-backdrop { position: fixed; inset: 0; z-index: var(--z-dropdown-backdrop, 400); background: transparent; }
  .poll-container { position: relative; padding: 0; margin: 0; background: transparent; border: none; width: 100%; user-select: none; -webkit-user-select: none; }
  .poll-confetti-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: var(--z-elevated, 10); }
  .poll-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .poll-footer { display: flex; justify-content: space-between; align-items: center; min-height: 24px; margin-top: 8px; padding-top: 4px; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 11.5px; color: var(--text-secondary, #9ca3af); }
  .poll-cancel-btn { background: none; border: none; color: var(--text-secondary, #9ca3af); font-size: 11.5px; font-family: inherit; cursor: pointer; padding: 4px 8px; margin: -4px -8px; border-radius: 4px; transition: color 0.15s ease, background-color 0.15s ease; touch-action: manipulation; user-select: none; -webkit-tap-highlight-color: transparent; }
  .poll-cancel-btn:hover, .poll-cancel-btn:active { color: #ef4444; background: rgba(239, 68, 68, 0.08); }
  .poll-badge-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .poll-badge { font-size: 10.5px; font-weight: 500; padding: 2px 6px; border-radius: 6px; background: rgba(255, 255, 255, 0.1); color: var(--text-secondary, #9ca3af); display: inline-flex; align-items: center; gap: 4px; }
  .poll-badge.closed { background: rgba(239, 68, 68, 0.15); color: #f87171; }
  .poll-action-wrap { position: relative; }
  .poll-more-btn { background: none; border: none; padding: 4px; color: var(--text-secondary, #9ca3af); cursor: pointer; border-radius: 4px; display: flex; align-items: center; }
  .poll-more-btn:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .poll-menu-dropdown { position: absolute; right: 0; top: 24px; z-index: var(--z-dropdown, 500); }
  .telegram-dropout-card { display: flex; flex-direction: column; width: 196px; background: #1c1e2a; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), 0 2px 10px rgba(0, 0, 0, 0.3); overflow: hidden; }
  .actions-group { display: flex; flex-direction: column; padding: 6px 0; }
  .action-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 14px; border: none; background: transparent; color: #ffffff; font-size: 13.5px; font-weight: 450; cursor: pointer; text-align: left; transition: background 0.12s ease; font-family: inherit; }
  .action-row:hover { background: rgba(255, 255, 255, 0.08); }
  .action-row:active { background: rgba(255, 255, 255, 0.14); }
  .action-icon { width: 18px; height: 18px; color: rgba(255, 255, 255, 0.75); flex-shrink: 0; }
  .action-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .poll-title { font-size: 14.5px; font-weight: 600; color: var(--text-primary, #f3f4f6); line-height: 1.3; margin-bottom: 8px; word-break: break-word; }
  .poll-options { display: flex; flex-direction: column; gap: 6px; }
  .poll-option-row { position: relative; display: flex; align-items: center; width: 100%; min-height: 34px; border-radius: 8px; box-sizing: border-box; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); overflow: hidden; user-select: none; -webkit-user-select: none; transition: background-color 0.15s ease, border-color 0.15s ease; }
  .poll-option-row.clickable { cursor: pointer; }
  .poll-option-row.clickable:hover { background: rgba(255, 255, 255, 0.09); border-color: rgba(255, 255, 255, 0.14); }
  .poll-option-row.my-choice { background: rgba(59, 130, 246, 0.1); border-color: rgba(59, 130, 246, 0.35); }
  .poll-progress-fill { position: absolute; inset: 0; background: rgba(255, 255, 255, 0.14); border-radius: 7px; transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1); pointer-events: none; }
  .poll-option-row.my-choice .poll-progress-fill { background: rgba(59, 130, 246, 0.28); }
  .poll-row-content { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 34px; padding: 6px 12px; box-sizing: border-box; font-size: 13.5px; }
  .poll-left-content { display: flex; align-items: center; flex: 1; min-width: 0; }
  .poll-indicator-slot { position: relative; width: 22px; height: 22px; margin-right: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .poll-indicator-wrap { position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0; box-sizing: border-box; user-select: none; -webkit-user-select: none; }
  .poll-indicator-wrap.pending { cursor: pointer; touch-action: manipulation; }
  .poll-indicator { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid rgba(255, 255, 255, 0.35); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; }
  .poll-check-svg { color: #3b82f6; flex-shrink: 0; }
  .poll-result-text { color: var(--text-primary, #f3f4f6); word-break: break-word; line-height: 1.35; user-select: none; -webkit-user-select: none; }
  .poll-result-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 8px; }
  .poll-count-chip { font-size: 11px; color: var(--text-secondary, #9ca3af); background: rgba(255, 255, 255, 0.08); padding: 1px 6px; border-radius: 10px; cursor: pointer; }
  .poll-count-chip:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
  .poll-percent { font-weight: 600; color: var(--text-secondary, #9ca3af); font-size: 12px; }
</style>
