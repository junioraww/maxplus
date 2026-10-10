<script>
  import { onDestroy } from "svelte";
  import { getContact } from "$lib/stores/contacts";
  import { currentSessionCalls, currentSessionChats, currentUser } from "$lib/stores/api";
  import Session from "$lib/stores/session";
  import Avatar from "$components/main/Avatar.svelte";

  let contacts = {}, unsub = {};
  let tab = "all";

  const peerOf = (call) =>
    call.chatType === "CHAT" ? null : (call.chatId ^ $currentUser);

  $: ($currentSessionCalls?.history || []).forEach((call) => {
    const id = call.chatType === "CHAT" ? call.message?.sender : peerOf(call);
    if (id && !unsub[id])
      unsub[id] = getContact(id).subscribe((v) => ((contacts[id] = v), (contacts = contacts)));
  });

  onDestroy(() => Object.values(unsub).forEach((f) => f()));

  function statusOf(call, a) {
    const outgoing = Number(call.message?.sender) === Number($currentUser);
    const hang = String(a?.hangupType ?? a?.hangup ?? a?.status ?? "").toUpperCase();
    const dur = Number(a?.duration) || 0;
    if (hang.includes("MISS") || (!outgoing && !dur && !hang.includes("CANCEL") && !hang.includes("REJECT")))
      return { kind: "missed", outgoing, label: "Пропущенный" };
    if (hang.includes("CANCEL") || hang.includes("REJECT") || !dur)
      return { kind: "canceled", outgoing, label: "Отменённый" };
    return { kind: "ok", outgoing, label: outgoing ? "Исходящий" : "Входящий" };
  }

  function formatDuration(s) {
    s = Math.round(Number(s) || 0);
    if (!s) return "";
    if (s < 60) return `${s} сек`;
    const m = (s / 60) | 0, r = s % 60;
    return r ? `${m} мин ${r} сек` : `${m} мин`;
  }

  function formatDate(ms) {
    if (!ms) return "";
    const d = new Date(ms), now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const opts = { day: "numeric", month: "short" };
    if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString("ru-RU", opts).replace(".", "");
  }

  $: rows = ($currentSessionCalls?.history || []).map((call) => {
    const a = call.message?.attaches?.find?.((x) => x._type === "CALL") || call.message?.attaches?.[0] || {};
    const st = statusOf(call, a);
    const base = { key: `${call.chatId}:${call.message?.id ?? call.message?.time}`, chatId: call.chatId,
      time: call.message?.time, status: st, duration: formatDuration(a.duration), video: a.callType === "VIDEO" };
    if (call.chatType === "CHAT") {
      const chat = $currentSessionChats?.find((x) => x.id === call.chatId);
      if (!chat) return null;
      return { ...base, isGroup: true, chat, name: chat.title, peerId: null };
    }
    const id = peerOf(call), c = contacts[id];
    return { ...base, isGroup: false, peerId: id, name: c?.names?.[0]?.name || c?.names?.[0]?.firstName || "Пользователь" };
  }).filter(Boolean);

  // Склеиваем подряд идущие одинаковые звонки одного собеседника: «Мама (2)»
  $: grouped = rows.reduce((acc, r) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.chatId === r.chatId && prev.status.kind === r.status.kind && r.status.kind !== "ok") prev.count++;
    else acc.push({ ...r, count: 1 });
    return acc;
  }, []);

  $: visible = tab === "missed" ? grouped.filter((r) => r.status.kind === "missed") : grouped;

  function openInfo(r) {
    $Session.profile = r.isGroup ? { chatId: r.chatId } : { userId: r.peerId, chatId: r.chatId };
  }

  const notReady = () => alert("В разработке!\nСледи за новостями:\nt.me/CatBestSoft");
</script>

<div class="calls">
  <header class="calls-head">
    <h1>Звонки</h1>
    <button class="round-btn" aria-label="Меню" on:click={notReady}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
      </svg>
    </button>
  </header>

  <button class="group-call" on:click={notReady}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
    <span>Создать групповой звонок</span>
  </button>

  <nav class="tabs">
    <button class:active={tab === "all"} on:click={() => (tab = "all")}>Все</button>
    <button class:active={tab === "missed"} on:click={() => (tab = "missed")}>Пропущенные</button>
  </nav>

  <div class="list">
    {#each visible as r (r.key)}
      <div class="row">
        {#if r.isGroup}
          <Avatar size={48} chat={r.chat} />
        {:else}
          <Avatar size={48} contactId={r.peerId} />
        {/if}
        <div class="main">
          <div class="name" class:missed={r.status.kind === "missed"}>
            {r.name}{#if r.count > 1}&nbsp;({r.count}){/if}
          </div>
          <div class="sub">
            <svg class="dir" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>
              {#if r.status.kind !== "ok"}
                <path d="M15 3l6 6M21 3l-6 6"/>
              {:else if r.status.outgoing}
                <path d="M16 8l5-5M16 3h5v5"/>
              {:else}
                <path d="M21 3l-5 5M16 3v5h5"/>
              {/if}
            </svg>
            <span>{r.status.label}{#if r.duration && r.status.kind === "ok"} · {r.duration}{/if}</span>
          </div>
        </div>
        <span class="date">{formatDate(r.time)}</span>
        <button class="info" aria-label="Информация" on:click={() => openInfo(r)}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/>
          </svg>
        </button>
      </div>
    {:else}
      <p class="empty">{tab === "missed" ? "Пропущенных звонков нет" : "Звонков пока нет"}</p>
    {/each}
  </div>
</div>

<style>
  .calls {
    --c-accent: var(--max-accent, #2f6fe0);
    --c-text: var(--max-text, #060708);
    --c-muted: var(--max-text-3, #7a7d82);
    --c-missed: #e0454b;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100dvh;
    padding-top: env(safe-area-inset-top, 0px);
    background: var(--max-surface, #fff);
    color: var(--c-text);
    overflow: hidden;
  }
  button { font: inherit; background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }

  .calls-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 4px; }
  .calls-head h1 { margin: 0; font-size: 26px; line-height: 32px; font-weight: 700; color: var(--c-text); }
  .round-btn {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(0, 0, 0, 0.06); color: var(--c-text);
  }

  .group-call { display: flex; align-items: center; gap: 22px; padding: 18px 16px 18px 28px; color: var(--c-accent); }
  .group-call span { font-size: 17px; font-weight: 600; }

  .tabs { display: flex; gap: 28px; padding: 0 20px; }
  .tabs button { position: relative; padding: 8px 0 12px; font-size: 17px; color: var(--c-muted); }
  .tabs button.active { color: var(--c-accent); }
  .tabs button.active::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0;
    height: 2px; border-radius: 2px; background: var(--c-accent);
  }

  .list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0 calc(90px + env(safe-area-inset-bottom)); }
  .row { display: flex; align-items: center; gap: 12px; min-height: 72px; padding: 6px 12px 6px 10px; }
  .row :global(> :first-child) { flex: 0 0 auto; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .name { font-size: 16px; line-height: 20px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.missed { color: var(--c-missed); }
  .sub { display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; color: var(--c-muted); min-width: 0; }
  .sub span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dir { flex: 0 0 16px; }
  .date { flex: 0 0 auto; font-size: 13px; color: var(--c-muted); }
  .info { flex: 0 0 auto; display: flex; padding: 4px; color: var(--c-text); }
  .empty { margin: 32px 16px; text-align: center; color: var(--c-muted); font-size: 15px; }
</style>
