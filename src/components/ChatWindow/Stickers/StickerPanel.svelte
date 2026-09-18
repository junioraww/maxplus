<script>
  import { onMount, tick, createEventDispatcher } from "svelte";
  import {
    orderedSetIds,
    favoriteSetIds,
    stickerSets,
    stickersById,
    recentStickerIds,
    stickersLoading,
    ensureLoaded,
    noteUsedSticker,
    searchStickers,
  } from "$lib/stores/stickers";
  import StickerMedia from "./StickerMedia.svelte";
  import StickerSection from "./StickerSection.svelte";
  import StickerCatalogModal from "./StickerCatalogModal.svelte";
  import StickerPackModal from "./StickerPackModal.svelte";

  const dispatch = createEventDispatcher();

  export let initialTab = "stickers";

  let activeTab = initialTab;
  let query = "";
  let searchResults = [];
  let isSearching = false;
  let searchTimer = null;
  let selectedSetId = null;
  let contentScrollEl;

  let showCatalogModal = false;
  let showPackModal = false;
  let openedSetId = null;

  let peekSticker = null;
  let peekTimer = null;

  const emojiCategories = [
    {
      name: "Смайлы и эмоции",
      emojis: [
        "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊",
        "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😋", "😛", "😜", "🤪", "😝",
        "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒",
        "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢",
        "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓",
        "🧐", "😕", "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨",
        "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱",
        "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠", "💩", "🤡", "👻", "👽", "🤖"
      ]
    },
    {
      name: "Жесты и люди",
      emojis: [
        "👋", "🤚", "🖐", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "👌", "🤌", "🤏",
        "✌", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝",
        "🫵", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲",
        "🤝", "🙏", "✍", "💅", "🤳", "💪", "🧠", "🫀", "🫁", "🦷", "🦴", "👀",
        "👁", "👅", "👄", "🫦"
      ]
    },
    {
      name: "Сердца и любовь",
      emojis: [
        "❤", "🩷", "🧡", "💛", "💚", "💙", "🩵", "💜", "🤎", "🖤", "🩶", "🤍",
        "💔", "❤‍🔥", "❤‍🩹", "❣", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟",
        "💌", "💋", "💯", "💥", "💫", "💦", "💨", "✨", "⭐", "🌟", "🔥"
      ]
    },
    {
      name: "Животные и природа",
      emojis: [
        "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
        "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗",
        "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🕷", "🐢", "🐍", "🐙",
        "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🦈", "🐊", "🐅",
        "🐆", "🦓", "🐘", "🦛", "🦏", "🐪", "🦒", "🦘", "🐕", "🐈", "🌸", "🌹",
        "🌺", "🌻", "🌼", "🌲", "🌳", "🌴", "🍀", "🍁", "🍂", "🍃"
      ]
    },
    {
      name: "Еда и напитки",
      emojis: [
        "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍒", "🍑",
        "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🥦", "🌽", "🥕", "🥔", "🥐", "🍞",
        "🥖", "🥨", "🧀", "🥚", "🍳", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌭",
        "🍔", "🍟", "🍕", "🥪", "🌮", "🌯", "🥗", "🥘", "🍝", "🍜", "🍲", "🍣",
        "🍱", "🥟", "🍦", "🍧", "🍨", "🍩", "🍪", "🎂", "🍰", "🧁", "🍫", "🍬",
        "🍭", "🍮", "🍯", "☕", "🫖", "🍵", "🍶", "🍾", "🍷", "🍸", "🍹", "🍺"
      ]
    }
  ];

  $: recentsSection = $recentStickerIds.length
    ? {
        id: "recents",
        name: "Недавние",
        icon: "recents",
        stickerIds: $recentStickerIds,
      }
    : null;

  $: favoriteSections = (() => {
    const list = [];
    for (const id of $favoriteSetIds) {
      const set = $stickerSets.get(id);
      if (set && set.stickerIds?.length) {
        list.push({
          id: set.id,
          name: set.name,
          iconUrl: set.iconUrl,
          stickerIds: set.stickerIds,
        });
      }
    }
    return list;
  })();

  $: recommendedSections = (() => {
    const list = [];
    const favSet = new Set($favoriteSetIds);
    for (const id of $orderedSetIds) {
      if (favSet.has(id)) continue;
      const set = $stickerSets.get(id);
      if (set && set.stickerIds?.length) {
        list.push({
          id: set.id,
          name: set.name,
          iconUrl: set.iconUrl,
          stickerIds: set.stickerIds,
        });
      }
    }
    return list;
  })();

  let recommendedBatchSize = 4;
  $: visibleRecommended = recommendedSections.slice(0, recommendedBatchSize);

  function handleContentScroll(e) {
    const el = e.currentTarget;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 350) {
      if (recommendedBatchSize < recommendedSections.length) {
        recommendedBatchSize += 4;
      }
    }
  }

  onMount(async () => {
    try {
      await ensureLoaded();
    } catch {}
  });

  function handleQueryChange(e) {
    const val = e.target.value;
    query = val;
    clearTimeout(searchTimer);
    if (!val.trim()) {
      searchResults = [];
      isSearching = false;
      return;
    }
    isSearching = true;
    searchTimer = setTimeout(async () => {
      try {
        searchResults = await searchStickers(val, 24);
      } catch {
        searchResults = [];
      } finally {
        isSearching = false;
      }
    }, 200);
  }

  function clearSearch() {
    query = "";
    searchResults = [];
    isSearching = false;
  }

  function selectSticker(sticker) {
    noteUsedSticker(sticker);
    dispatch("sendSticker", { sticker });
  }

  function insertEmoji(emoji) {
    dispatch("insertEmoji", { emoji });
  }

  async function scrollToSection(secId) {
    selectedSetId = secId;
    if (secId !== "recents" && !$favoriteSetIds.includes(secId)) {
      const idx = recommendedSections.findIndex(s => s.id === secId);
      if (idx !== -1 && idx >= recommendedBatchSize) {
        recommendedBatchSize = idx + 3;
        await tick();
      }
    }
    if (!contentScrollEl) return;
    const target = contentScrollEl.querySelector(`[data-section-id="${secId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function startPeek(sticker) {
    peekTimer = setTimeout(() => {
      peekSticker = sticker;
    }, 250);
  }

  function endPeek() {
    clearTimeout(peekTimer);
    peekSticker = null;
  }
</script>

<div class="sticker-panel-wrapper">
  <div class="panel-mode-toggle">
    <button
      type="button"
      class="mode-btn"
      class:active={activeTab === "emoji"}
      on:click={() => (activeTab = "emoji")}
    >
      <svg class="mode-icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
        <line x1="9" y1="9" x2="9.01" y2="9"/>
        <line x1="15" y1="9" x2="15.01" y2="9"/>
      </svg>
      <span class="mode-text">Эмодзи</span>
    </button>
    <button
      type="button"
      class="mode-btn"
      class:active={activeTab === "stickers"}
      on:click={() => (activeTab = "stickers")}
    >
      <svg class="mode-icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
      </svg>
      <span class="mode-text">Стикеры</span>
    </button>
  </div>

  {#if activeTab === "emoji"}
    <div class="emoji-scroll-area">
      {#each emojiCategories as cat}
        <div class="category-block">
          <div class="category-title">{cat.name}</div>
          <div class="emoji-grid">
            {#each cat.emojis as em}
              <button
                type="button"
                class="emoji-item"
                on:click={() => insertEmoji(em)}
              >
                {em}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="stickers-view">
      <div class="search-bar">
        <div class="search-input-box">
          <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            type="text"
            placeholder="Поиск по стикерам"
            value={query}
            on:input={handleQueryChange}
          />
          {#if query}
            <button type="button" class="clear-btn" on:click={clearSearch}>
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          {/if}
        </div>
      </div>

      {#if !query}
        <div class="pack-tabs-bar">
          {#if recentsSection}
            <button
              type="button"
              class="pack-tab-item"
              class:selected={selectedSetId === "recents"}
              on:click={() => scrollToSection("recents")}
              title="Недавние"
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
              </svg>
            </button>
          {/if}

          {#each favoriteSections as sec (sec.id)}
            <button
              type="button"
              class="pack-tab-item"
              class:selected={selectedSetId === sec.id}
              on:click={() => scrollToSection(sec.id)}
              title={sec.name}
            >
              {#if sec.iconUrl}
                <img src={sec.iconUrl} alt="" class="tab-pack-img" />
              {:else}
                <div class="tab-placeholder">{sec.name.slice(0, 1)}</div>
              {/if}
            </button>
          {/each}

          <button
            type="button"
            class="pack-tab-item add-pack-tab"
            on:click={() => { showCatalogModal = true; }}
            title="Каталог стикеров"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </button>
        </div>
      {/if}

      <div class="stickers-content-area" bind:this={contentScrollEl} on:scroll={handleContentScroll}>
        {#if $stickersLoading && !recentsSection && favoriteSections.length === 0 && recommendedSections.length === 0}
          <div class="loading-state">
            <div class="spinner"></div>
            <span>Загрузка стикеров...</span>
          </div>
        {:else if query}
          {#if isSearching}
            <div class="loading-state">
              <div class="spinner"></div>
            </div>
          {:else if searchResults.length === 0}
            <div class="empty-state">
              <span>Ничего не найдено</span>
            </div>
          {:else}
            <div class="stickers-grid">
              {#each searchResults as st (st.id)}
                <button
                  type="button"
                  class="sticker-cell"
                  on:click={() => selectSticker(st)}
                  on:mousedown={() => startPeek(st)}
                  on:mouseup={endPeek}
                  on:mouseleave={endPeek}
                  on:touchstart={() => startPeek(st)}
                  on:touchend={endPeek}
                  title={st.tags?.join(", ") || ""}
                >
                  <StickerMedia
                    url={st.url}
                    lottieUrl={st.lottieUrl}
                    size={76}
                    autoplay={true}
                    loop={true}
                  />
                </button>
              {/each}
            </div>
          {/if}
        {:else}
          {#if recentsSection}
            <StickerSection
              section={recentsSection}
              isFavorite={false}
              initialInView={true}
              on:select={(e) => selectSticker(e.detail.sticker)}
              on:peekStart={(e) => startPeek(e.detail.sticker)}
              on:peekEnd={endPeek}
            />
          {/if}

          {#if favoriteSections.length > 0}
            <div class="group-title">Мои стикеры</div>
            {#each favoriteSections as sec, idx (sec.id)}
              <StickerSection
                section={sec}
                isFavorite={true}
                initialInView={idx < 2}
                on:select={(e) => selectSticker(e.detail.sticker)}
                on:peekStart={(e) => startPeek(e.detail.sticker)}
                on:peekEnd={endPeek}
                on:openPack={(e) => {
                  openedSetId = e.detail.setId;
                  showPackModal = true;
                }}
              />
            {/each}
          {/if}

          {#if visibleRecommended.length > 0}
            <div class="group-title">Рекомендуемые</div>
            {#each visibleRecommended as sec, idx (sec.id)}
              <StickerSection
                section={sec}
                isFavorite={false}
                initialInView={favoriteSections.length === 0 && idx < 2}
                on:select={(e) => selectSticker(e.detail.sticker)}
                on:peekStart={(e) => startPeek(e.detail.sticker)}
                on:peekEnd={endPeek}
                on:openPack={(e) => {
                  openedSetId = e.detail.setId;
                  showPackModal = true;
                }}
              />
            {/each}
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if showCatalogModal}
    <StickerCatalogModal
      on:close={() => { showCatalogModal = false; }}
      on:openPack={(e) => {
        openedSetId = e.detail.setId;
        showPackModal = true;
      }}
    />
  {/if}

  {#if showPackModal && openedSetId}
    <StickerPackModal
      setId={openedSetId}
      on:close={() => {
        showPackModal = false;
        openedSetId = null;
      }}
      on:select={(e) => {
        selectSticker(e.detail.sticker);
        showPackModal = false;
        openedSetId = null;
      }}
    />
  {/if}

  {#if peekSticker}
    <div class="peek-overlay" on:click={endPeek}>
      <div class="peek-content">
        {#if peekSticker.tags?.length}
          <div class="peek-tags">
            {#each peekSticker.tags as tag}
              <span class="peek-tag">{tag}</span>
            {/each}
          </div>
        {/if}
        <StickerMedia
          url={peekSticker.url}
          lottieUrl={peekSticker.lottieUrl}
          size={180}
          autoplay={true}
          loop={true}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .sticker-panel-wrapper {
    display: flex;
    flex-direction: column;
    height: 340px;
    background: #17191d;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    user-select: none;
    position: relative;
    overflow: hidden;
  }

  .panel-mode-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: #1b1d22;
  }

  .mode-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    background: transparent;
    border: none;
    border-radius: 20px;
    color: #8b929e;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mode-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.04);
  }

  .mode-btn.active {
    color: #fff;
    background: rgba(36, 139, 254, 0.2);
  }

  .mode-icon-svg {
    flex-shrink: 0;
  }

  .emoji-scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .category-title {
    font-size: 12px;
    font-weight: 700;
    color: #8b929e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: 6px;
  }

  .emoji-item {
    background: none;
    border: none;
    font-size: 22px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.12s, background-color 0.12s;
  }

  .emoji-item:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: scale(1.2);
  }

  .emoji-item:active {
    transform: scale(0.95);
  }

  .stickers-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .search-bar {
    padding: 8px 12px 6px;
  }

  .search-input-box {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 4px 12px;
    gap: 8px;
  }

  .search-icon {
    color: #8b929e;
    flex-shrink: 0;
  }

  .search-input-box input {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 13px;
    outline: none;
  }

  .search-input-box input::placeholder {
    color: #636b77;
  }

  .clear-btn {
    background: none;
    border: none;
    color: #8b929e;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pack-tabs-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    overflow-x: auto;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    scrollbar-width: none;
    flex-shrink: 0;
  }

  .pack-tabs-bar::-webkit-scrollbar {
    display: none;
  }

  .pack-tab-item {
    background: none;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #8b929e;
    transition: background-color 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .pack-tab-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }

  .pack-tab-item.selected {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .add-pack-tab {
    color: #248bfe;
    background: rgba(36, 139, 254, 0.08);
    margin-left: auto;
  }

  .add-pack-tab:hover {
    background: rgba(36, 139, 254, 0.18);
    color: #fff;
  }

  .tab-pack-img {
    width: 24px;
    height: 24px;
    object-fit: contain;
    border-radius: 4px;
  }

  .tab-placeholder {
    font-size: 13px;
    font-weight: 700;
    color: #8b929e;
  }

  .stickers-content-area {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .group-title {
    font-size: 11px;
    font-weight: 700;
    color: #636b77;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin: 8px 4px 6px;
  }

  .stickers-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }

  .sticker-cell {
    background: none;
    border: none;
    padding: 4px;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s, transform 0.15s;
    user-select: none;
  }

  .sticker-cell:hover {
    background: rgba(255, 255, 255, 0.06);
    transform: scale(1.05);
  }

  .sticker-cell:active {
    transform: scale(0.95);
  }

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 0;
    color: #8b929e;
    font-size: 13px;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: #248bfe;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .peek-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    animation: peekFadeIn 0.15s ease;
  }

  @keyframes peekFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .peek-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .peek-tags {
    display: flex;
    gap: 6px;
    background: rgba(0, 0, 0, 0.5);
    padding: 4px 10px;
    border-radius: 12px;
  }

  .peek-tag {
    font-size: 16px;
  }
</style>
