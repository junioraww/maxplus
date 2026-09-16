<script>
  import { createEventDispatcher } from "svelte";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";

  export let folders = [];
  export let activeFolder = null;

  const dispatch = createEventDispatcher();

  let isEditing = false;
  let draggingIndex = null;

  let lastReorderTime = 0;
  const REORDER_COOLDOWN = 250; // должно быть близко к duration анимации

  function selectFolder(folder) {
    if (isEditing) return;
    activeFolder = folder;
    dispatch("folderChange", folder);
  }

  function toggleEditMode() {
    isEditing = !isEditing;
    if (!isEditing) draggingIndex = null;
    dispatch("editFolders", isEditing);
  }

  function handleStart(index, e) {
    if (!isEditing) return;
    draggingIndex = index;
  }

  function handleMove(e) {
    if (!isEditing || draggingIndex === null) return;

    if (Date.now() - lastReorderTime < REORDER_COOLDOWN) return;

    let clientX, clientY;
    if (e.type.startsWith("touch")) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
      e.preventDefault();
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const elementUnderCursor = document.elementFromPoint(clientX, clientY);
    const tabWrapper = elementUnderCursor?.closest(".tab-wrapper");

    if (tabWrapper && tabWrapper.dataset.index) {
      const hoverIndex = parseInt(tabWrapper.dataset.index);

      // наехали на другой элемент
      if (hoverIndex !== draggingIndex) {
        const newFolders = [...folders];
        const [movedItem] = newFolders.splice(draggingIndex, 1);
        newFolders.splice(hoverIndex, 0, movedItem);

        folders = newFolders;
        draggingIndex = hoverIndex;

        lastReorderTime = Date.now();

        dispatch("reorder", folders);
      }
    }
  }

  function handleEnd() {
    draggingIndex = null;
  }
</script>

<svelte:window
  on:mouseup={handleEnd}
  on:mousemove={handleMove}
  on:touchend={handleEnd}
  on:touchmove|nonpassive={handleMove}
/>

<div class="tabs-container">
  <div class="tabs">
    {#each folders as folder, index (folder.id)}
      <div
        animate:flip={{ duration: 250, easing: quintOut }}
        class="tab-wrapper"
        class:shaking={isEditing}
        class:dragging={draggingIndex === index}
        data-index={index}
        on:mousedown={(e) => handleStart(index, e)}
        on:touchstart|passive={(e) => handleStart(index, e)}
      >
        <button
          class="tab"
          class:active={activeFolder === folder && !isEditing}
          on:click={() => selectFolder(folder)}
        >
          <span>{folder.title}</span>
        </button>

        {#if isEditing && folder.id !== 0 && folder.id !== "all.chat.folder"}
          <button
            class="edit-icon"
            on:click|stopPropagation={() => dispatch("editFolder", folder)}
            on:touchstart|stopPropagation
            on:mousedown|stopPropagation
          >
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
              ></path><path
                d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
              ></path></svg
            >
          </button>
        {/if}
      </div>
    {/each}

    {#if isEditing}
      <button
        class="add-tab-btn"
        title="Добавить папку"
        on:click|stopPropagation={() => dispatch("addFolder")}
      >
        +
      </button>
    {/if}
  </div>

  <button class="edit-btn" class:active={isEditing} on:click={toggleEditMode}>
    {isEditing ? "Готово" : "Изм."}
  </button>
</div>

<style>
  .tabs-container {
    display: flex;
    width: 100%;
    align-items: center;
    border-bottom: 1px solid #333;
    background: #1e1e1e;
    position: relative;
    z-index: 10;
    user-select: none;
    -webkit-user-select: none;
  }

  .tabs {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1 1 auto;
    min-width: 0;
    padding-left: 5px;
    padding-right: 8px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    margin-right: 4px;
    touch-action: pan-x;
    padding: 2px 0;
    flex-shrink: 0;
  }

  .tab-wrapper.dragging {
    opacity: 0.5;
    z-index: 100;
    pointer-events: none;
  }

  @keyframes shake {
    0% {
      transform: rotate(0deg);
    }
    25% {
      transform: rotate(1.5deg) translateY(-1px);
    }
    50% {
      transform: rotate(0deg);
    }
    75% {
      transform: rotate(-1.5deg) translateY(1px);
    }
    100% {
      transform: rotate(0deg);
    }
  }

  .shaking {
    animation: shake 0.3s infinite ease-in-out;
    cursor: grab;
  }

  .shaking.dragging {
    animation: none;
    transform: scale(1.05);
  }

  .edit-icon {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #007afd;
    border: 2px solid #1e1e1e;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    cursor: pointer;
    z-index: 2;
    padding: 0;
    pointer-events: auto;
  }

  .tab {
    position: relative;
    padding: 10px 16px;
    background: none;
    border: none;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    color: #999;
    white-space: nowrap;
    border-radius: 8px;
    transition:
      background 0.2s,
      color 0.2s;
  }

  .shaking .tab {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #444;
    padding: 9px 15px;
  }

  .tab:hover {
    color: #ccc;
  }
  .tab.active {
    color: #fff;
  }

  .tab.active:not(.shaking .tab)::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%) scaleX(1);
    width: 80%;
    height: 3px;
    background-color: #007afd;
    border-radius: 3px 3px 0 0;
  }

  .edit-btn {
    padding: 0 15px;
    background: none;
    border: none;
    cursor: pointer;
    color: #007afd;
    font-weight: bold;
    font-size: 14px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .add-tab-btn {
    background: #282830;
    border: 1px dashed #555;
    color: #bbb;
    padding: 6px 14px;
    margin: 4px;
    border-radius: 8px;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .add-tab-btn:hover {
    background: #363642;
    color: #fff;
    border-color: #777;
  }
</style>
