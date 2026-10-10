<script>
  import { IconButton, MenuItem, Modal } from "$components/ui";
  import { createEventDispatcher, onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { isChatMuted } from "$lib/utils/notifications";

  /** @type {any} */
  export let chat;
  /** @type {any[]} */
  export let folders = [];

  const dispatch = createEventDispatcher();

  /** @type {"main" | "folders" | "mute"} */
  let view = "main";

  $: muted = isChatMuted(chat);
  $: userFolders = (folders || []).filter(
    (f) => f && f.id !== 0 && f.id !== "all.chat.folder" && f.title !== "Все"
  );

  /** @param {any} folder */
  function inFolder(folder) {
    const list = folder?.include || folder?.includedChats || [];
    return list.map(String).includes(String(chat?.id));
  }

  const HOUR = 60 * 60 * 1000;
  const muteOptions = [
    { label: "На 1 час", ms: HOUR },
    { label: "На 8 часов", ms: 8 * HOUR },
    { label: "На 1 день", ms: 24 * HOUR },
    { label: "Навсегда", ms: -1 },
  ];

  function close() {
    dispatch("close");
  }

  /** @param {string} type @param {any} [payload] */
  function act(type, payload) {
    dispatch("action", { type, chat, payload });
    close();
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.key === "Escape") {
      if (view !== "main") view = "main";
      else close();
    }
  }

  onMount(() => {
    if (navigator.vibrate) navigator.vibrate(10);
  });
</script>

<svelte:window on:keydown={onKey} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<Modal open={true} bare closeOnEsc={false} position="bottom" onclose={close}>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
  >
    <div class="handle" aria-hidden="true"></div>

    {#if view === "main"}
      <ul class="list" role="menu">
        {#if userFolders.length}
          <li>
            <MenuItem class="chatcontextsheet-row" role="menuitem" onclick={() => (view = "folders")}>{#snippet icon()}<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 10.5v5.5M9.5 13.5 12 16l2.5-2.5"/></svg>{/snippet}<span class="label">Добавить в папку</span>
              <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></MenuItem>
          </li>
        {/if}
        <li>
          <MenuItem class="chatcontextsheet-row" role="menuitem" onclick={() => act("pin")}>{#snippet icon()}<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3.5 20.5 9.5l-2.2.6-3.4 3.4-.6 4.3-1.3 1.3-3.6-3.6L5 20l-1-1 4.5-4.4-3.6-3.6 1.3-1.3 4.3-.6 3.4-3.4z"/></svg>{/snippet}<span class="label">Закрепить</span></MenuItem>
        </li>
        <li>
          <MenuItem class="chatcontextsheet-row" role="menuitem" onclick={() => act("unread")}>{#snippet icon()}<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4H6.5A2.5 2.5 0 0 0 4 6.5v8A2.5 2.5 0 0 0 6.5 17H8v3l4-3h5.5a2.5 2.5 0 0 0 2.5-2.5V10"/><circle cx="19" cy="5" r="2.2" class="fill"/><circle cx="8.5" cy="10.5" r=".6" class="fill"/><circle cx="12" cy="10.5" r=".6" class="fill"/><circle cx="15.5" cy="10.5" r=".6" class="fill"/></svg>{/snippet}<span class="label">Отметить непрочитанным</span></MenuItem>
        </li>
        <li>
          {#if muted}
            <MenuItem class="chatcontextsheet-row" role="menuitem" onclick={() => act("mute", 0)}>{#snippet icon()}<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/></svg>{/snippet}<span class="label">Включить уведомления</span></MenuItem>
          {:else}
            <MenuItem class="chatcontextsheet-row" role="menuitem" onclick={() => (view = "mute")}>{#snippet icon()}<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 3.9A6 6 0 0 1 18 8.5c0 3 .5 5 1.2 6.3M17 17H3.5S6 15 6 8.5c0-.6.1-1.2.3-1.8"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/><path d="m3 3 18 18"/></svg>{/snippet}<span class="label">Отключить уведомления</span>
              <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></MenuItem>
          {/if}
        </li>
        <li>
          <MenuItem class="chatcontextsheet-row" role="menuitem" onclick={() => act("select")}>{#snippet icon()}<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/></svg>{/snippet}<span class="label">Выбрать</span></MenuItem>
        </li>
      </ul>
    {:else}
      <div class="subheader">
        <IconButton class="chatcontextsheet-back" aria-label="Назад" onclick={() => (view = "main")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>
        </IconButton>
        <span>{view === "folders" ? "Добавить в папку" : "Отключить уведомления"}</span>
      </div>

      <ul class="list" role="menu">
        {#if view === "folders"}
          {#each userFolders as folder (folder.id)}
            {@const checked = inFolder(folder)}
            <li>
              <MenuItem class="chatcontextsheet-row" role="menuitemcheckbox" aria-checked={checked} onclick={() => act("folder", folder)}>{#snippet icon()}<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>{/snippet}<span class="label">{folder.title}</span>
                {#if checked}
                  <svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
                {/if}</MenuItem>
            </li>
          {/each}
        {:else}
          {#each muteOptions as opt}
            <li>
              <MenuItem class="chatcontextsheet-row chatcontextsheet-row--plain" role="menuitem" onclick={() => act("mute", opt.ms === -1 ? -1 : Date.now() + opt.ms)}><span class="label">{opt.label}</span></MenuItem>
            </li>
          {/each}
        {/if}
      </ul>
    {/if}
  </div>
</Modal>

<style>

  .sheet {
    width: 100%;
    max-width: 520px;
    padding: 8px 0 calc(12px + env(safe-area-inset-bottom, 0px));
    border-radius: 24px 24px 0 0;
    background: var(--background-primary, var(--bg-surface, #fff));
    color: var(--text-primary);
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.08);
  }

  .handle {
    width: 36px;
    height: 4px;
    margin: 4px auto 12px;
    border-radius: 2px;
    background: var(--icon-mute, #06070833);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  :global(.chatcontextsheet-row)  { width: 100%; margin: 0; }

  @media (hover: hover) {
  }


  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .icon,
  .chevron,
  .check {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  :global(.chatcontextsheet-back) svg  { flex-shrink: 0; width: 24px; }

  .icon {
    color: var(--icon-primary, var(--text-primary));
  }

  .icon .fill {
    fill: currentColor;
    stroke: none;
  }

  .chevron {
    color: var(--icon-primary, var(--text-primary));
  }

  .check {
    color: var(--icon-themed, var(--accent-primary));
    stroke-width: 2;
  }

  .subheader {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 12px;
    font: 600 var(--font-title-size, 17px) / var(--font-title-line-height, 24px) var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
  }

  :global(.chatcontextsheet-back)  { width: 40px; }

</style>
