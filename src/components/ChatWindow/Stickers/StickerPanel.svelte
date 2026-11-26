<script>
  import { onMount, onDestroy, tick, createEventDispatcher } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton";
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
  import StickerPackModal from "./StickerPackModal.svelte";
  import StickerSettingsScreen from "./StickerSettingsScreen.svelte";
  import StickerCatalogScreen from "./StickerCatalogScreen.svelte";
  import { openScreen, openSheet } from "$lib/services/layerManager";
  import { getMountStore } from "$lib/plugins/mount-registry";

  const dispatch = createEventDispatcher();

  export let initialTab = "stickers";

  let activeTab = initialTab;
  let query = "";
  let searchResults = [];
  let isSearching = false;
  let searchTimer = null;
  let selectedSetId = null;
  let contentScrollEl;
  let emojiScrollEl;
  let emojiTabsBarEl;
  let selectedEmojiCat = "smileys";
  let isManualScrollingEmoji = false;
  let manualEmojiScrollTimer = null;
  let emojiScrollRaf = null;

  function handleOpenPack(setId) {
    if (!setId) return;
    openSheet(StickerPackModal, {
      setId,
      onSelect: (sticker) => selectSticker(sticker),
    });
  }

  function handleOpenSettings() {
    openScreen(StickerSettingsScreen, {}, { canSwipe: true });
  }

  function handleOpenCatalog() {
    openScreen(StickerCatalogScreen, {}, { canSwipe: true });
  }

  let peekSticker = null;
  let peekTimer = null;

  let unregPeek = null;

  $: if (peekSticker) {
    if (!unregPeek) {
      unregPeek = registerBackHandler(() => {
        endPeek();
        return true;
      });
    }
  } else {
    if (unregPeek) {
      unregPeek();
      unregPeek = null;
    }
  }

  onDestroy(() => {
    if (unregPeek) unregPeek();
    if (manualEmojiScrollTimer) clearTimeout(manualEmojiScrollTimer);
    if (emojiScrollRaf) cancelAnimationFrame(emojiScrollRaf);
  });

  const pluginTabs = getMountStore("sticker-panel:tab");
  const pluginContents = getMountStore("sticker-panel:tab-content");

  const emojiCategories = [
    {
      id: "smileys",
      name: "Смайлы и эмоции",
      icon: "😀",
      emojis: [
        "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "🫠", "😉", "😊", "😇",
        "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗",
        "🤭", "🤫", "🫢", "🫣", "🤔", "🫡", "🤐", "🤨", "😐", "😑", "😶", "🫥", "😶‍🌫️", "😏",
        "😒", "🙄", "😬", "🤥", "🫨", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢",
        "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "😵‍💫", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐",
        "😕", "🫤", "😟", "🙁", "☹️", "😮", "😯", "😲", "😳", "🥺", "🥹", "😦", "😧", "😨",
        "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡",
        "😠", "🤬", "😈", "👿", "💀", "☠️", "💩", "🤡", "👹", "👺", "👻", "👽", "👾", "🤖",
        "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾", "🙈", "🙉", "🙊", "💋", "💌",
        "💘", "💝", "💖", "💗", "💓", "💞", "💕", "💟", "❣️", "💔", "❤️‍🔥", "❤️‍🩹", "❤️", "🩷",
        "🧡", "💛", "💚", "💙", "🩵", "💜", "🤎", "🖤", "🩶", "🤍", "💥", "💫", "💦", "💨",
        "💬", "💭", "💤"
      ]
    },
    {
      id: "people",
      name: "Люди и тело",
      icon: "👋",
      emojis: [
        "👋", "🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "🫷", "🫸", "👌", "🤌", "🤏",
        "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "🫵", "👍",
        "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅",
        "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴",
        "👀", "👁️", "👅", "👄", "🫦", "👶", "🧒", "👦", "👧", "🧑", "👱", "👨", "🧔", "👩",
        "🧓", "👴", "👵", "🙍", "🙎", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦", "🤷", "👮",
        "🕵️", "💂", "👷", "🫅", "🤴", "👸", "👳", "👲", "🧕", "🤵", "👰", "🤰", "🫃", "🫄",
        "🤱", "👼", "🎅", "🤶", "🦸", "🦹", "🧙", "🧚", "🧛", "🧜", "🧝", "🧞", "🧟", "🚶",
        "🏃", "💃", "🕺", "🕴️", "🧖", "🧗", "🤺", "🏇", "⛷️", "🏂", "🏌️", "🏄", "🚣", "🏊",
        "⛹️", "🏋️", "🚴", "🚵", "🤸", "🤼", "🤽", "🤾", "🤹", "🧘", "🛀", "🛌", "👭", "👫", "👬"
      ]
    },
    {
      id: "nature",
      name: "Животные и природа",
      icon: "🐱",
      emojis: [
        "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨", "🐯", "🦁", "🐮", "🐷",
        "🐽", "🐸", "🐵", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇",
        "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛", "🦋", "🐌", "🐞", "🐜", "🪰", "🪲", "🪳",
        "🦟", "🦗", "🕷️", "🕸️", "🦂", "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🪼", "🦐",
        "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🦭", "🐊", "🐅", "🐆", "🦓",
        "🦍", "🦧", "🦣", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🦬", "🐃", "🐂", "🐄",
        "🐎", "🐖", "🐏", "🐑", "🦙", "🐐", "🦌", "🐕", "🐩", "🦮", "🐈", "🐈‍⬛", "🪶", "🐓",
        "🦃", "🦚", "🦜", "🦢", "🦩", "🕊️", "🐇", "🦝", "🦨", "🦡", "🦫", "🦦", "🦥", "🐁",
        "🐀", "🐿️", "🦔", "🐾", "🌵", "🎄", "🌲", "🌳", "🌴", "🪵", "🌱", "🌿", "☘️", "🍀",
        "🎍", "🪴", "🎋", "🍃", "🍂", "🍁", "🍄", "🌾", "💐", "🌷", "🌹", "🥀", "🪻", "🪷",
        "🌺", "🌸", "🌼", "🌻", "🌞", "🌝", "🌛", "🌜", "🌚", "🌕", "🌖", "🌗", "🌘", "🌑",
        "🌒", "🌓", "🌔", "🌙", "🌎", "🌍", "🌏", "🪐", "💫", "⭐️", "🌟", "✨", "⚡️", "☄️",
        "🔥", "🌪️", "🌈", "☀️", "🌤️", "⛅️", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️",
        "❄️", "☃️", "⛄️", "💨", "💧", "💦", "🫧", "🌊"
      ]
    },
    {
      id: "food",
      name: "Еда и напитки",
      icon: "🍔",
      emojis: [
        "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭",
        "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "pea", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕",
        "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈",
        "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆",
        "🌮", "🌯", "🫔", "🥗", "🥘", "🫕", "🥫", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟",
        "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧",
        "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "🥛",
        "🍼", "☕️", "🫖", "🍵", "🍶", "🍾", "🍷", "🍸", "🍹", "🍺", "🍻", "🥂", "🥃", "🥤",
        "🧋", "🧃", "🧉", "🧊", "🥢", "🍽️", "🍴", "🥄", "🔪"
      ]
    },
    {
      id: "travel",
      name: "Путешествия и места",
      icon: "✈️",
      emojis: [
        "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚", "🚛", "🚜",
        "🛴", "🚲", "🛵", "🏍️", "🛺", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟", "🚃",
        "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂", "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬",
        "🛩️", "💺", "🛰️", "🚀", "🛸", "🚁", "🛶", "⛵️", "🚤", "🛥️", "🛳️", "⛴️", "🚢", "⚓️",
        "🛟", "⛽️", "🚧", "🚦", "🚥", "🚏", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯", "🏟️", "🎡",
        "🎢", "🎠", "⛲️", "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️", "🗻", "🏕️", "⛺️", "🛖",
        "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏭", "🏢", "🏬", "🏣", "🏤", "🏥", "🏦", "🏨", "🏪",
        "🏫", "🏩", "💒", "🏛️", "⛪️", "🕌", "🛕", "🕍", "⛩️", "🕋"
      ]
    },
    {
      id: "activities",
      name: "Активности и спорт",
      icon: "⚽",
      emojis: [
        "⚽️", "🏀", "🏈", "⚾️", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓", "🏸", "🏒",
        "🏑", "🥍", "🏏", "🪃", "🥅", "⛳️", "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹",
        "🛼", "🛷", "⛸️", "🥌", "🎿", "🪂", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️",
        "🎫", "🎟️", "🎪", "🤹", "🎭", "🩰", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁", "🪘",
        "🎷", "🎺", "🪗", "🎸", "🪕", "🎻", "🎲", "♟️", "🎯", "🎳", "🎮", "🎰", "🧩"
      ]
    },
    {
      id: "objects",
      name: "Предметы",
      icon: "💡",
      emojis: [
        "⌚️", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🕹️", "💽", "💾", "💿", "📀", "📼",
        "📷", "📸", "📹", "🎥", "📽️", "🎞️", "📞", "☎️", "📟", "📠", "📺", "📻", "🎙️", "🎚️",
        "🎛️", "⏱️", "⏲️", "⏰", "🕰️", "⌛️", "⏳", "📡", "🔋", "🪫", "🔌", "💡", "🔦", "🕯️",
        "🪔", "🧯", "🛢️", "💸", "💵", "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜",
        "🧰", "🪛", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🪚", "🔩", "⚙️", "🪤", "🧱", "⛓️", "🧲",
        "🔫", "💣", "🧨", "🪓", "🔪", "🗡️", "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮",
        "📿", "🧿", "💈", "⚗️", "🔭", "🔬", "💊", "💉", "🩸", "🩹", "🩺", "🩻", "🚪", "🛗",
        "🪞", "🪟", "🛏️", "🛋️", "🪑", "🚽", "🪠", "🚿", "🛁", "🪒", "🧴", "🧷", "🧹", "🧺",
        "🧻", "🪣", "🧼", "🪥", "🧽", "🛒", "🔔", "🔕"
      ]
    },
    {
      id: "symbols",
      name: "Символы",
      icon: "🔣",
      emojis: [
        "🏧", "🚮", "🚰", "♿️", "🚹", "🚺", "🚻", "🚼", "🚾", "🛂", "🛃", "🛄", "🛅", "⚠️",
        "🚸", "⛔️", "🚫", "🚳", "🚭", "🚯", "🚱", "🚷", "📵", "🔞", "☢️", "☣️", "⬆️", "↗️",
        "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️", "↕️", "↔️", "↩️", "↪️", "⤴️", "⤵️", "🔃", "🔄",
        "🔙", "🔚", "🔛", "🔜", "🔝", "🛐", "⚛️", "🕉️", "✡️", "☸️", "☯️", "✝️", "☦️", "☪️",
        "☮️", "🕎", "🔯", "♈️", "♉️", "♊️", "♋️", "♌️", "♍️", "♎️", "♏️", "♐️", "♑️", "♒️",
        "♓️", "⛎", "🔀", "🔁", "🔂", "▶️", "⏩", "⏭️", "⏯️", "◀️", "⏪", "⏮️", "🔼", "⏫",
        "🔽", "⏬", "⏸️", "⏹️", "⏺️", "⏏️", "🎦", "🔅", "🔆", "📶", "📳", "📴", "♀️", "♂️",
        "⚧️", "✖️", "➕", "➖", "➗", "🟰", "♾️", "‼️", "⁉️", "❓", "❔", "❕", "❗️", "〰️",
        "💲", "⚕️", "♻️", "⚜️", "🔱", "📛", "🔰", "⭕️", "✅", "☑️", "✔️", "❌", "❎", "➰",
        "➿", "〽️", "✳️", "✴️", "❇️", "©️", "®️", "™️", "#️⃣", "*️⃣", "0️⃣", "1️⃣", "2️⃣", "3️⃣",
        "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "🔠", "🔡", "🔢", "🔣", "🔤", "🅰️", "🆎",
        "🅱️", "🆑", "🆒", "🆓", "ℹ️", "🆔", "Ⓜ️", "🆕", "🆖", "🅾️", "🆗", "🅿️", "🆘", "🆙",
        "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "⚫️", "⚪️", "🟥", "🟧", "🟨", "🟩", "🟦",
        "🟪", "🟫", "⬛️", "⬜️", "🔶", "🔷", "🔸", "🔹", "🔺", "🔻", "💠", "🔘", "🔳", "🔲"
      ]
    },
    {
      id: "flags",
      name: "Флаги",
      icon: "🏁",
      emojis: [
        "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️", "🇦🇫", "🇦🇱", "🇩🇿", "🇦🇩", "🇦🇴", "🇦🇷",
        "🇦🇲", "🇦🇺", "🇦🇹", "🇦🇿", "🇧🇸", "🇧🇭", "🇧🇩", "🇧🇾", "🇧🇪", "🇧🇿", "🇧🇴", "🇧🇦", "🇧🇷", "🇧🇬",
        "🇨🇲", "🇨🇦", "🇨🇱", "🇨🇳", "🇨🇴", "🇨🇷", "🇭🇷", "🇨🇺", "🇨🇾", "🇨🇿", "🇩🇰", "🇪🇨", "🇪🇬", "🇸🇻",
        "🇪🇪", "🇪🇹", "🇪🇺", "🇫🇮", "🇫🇷", "🇬🇪", "🇩🇪", "🇬🇭", "🇬🇷", "🇬🇹", "🇭🇹", "🇭🇳", "🇭🇰", "🇭🇺",
        "🇮🇸", "🇮🇳", "🇮🇩", "🇮🇷", "🇮🇶", "🇮🇪", "🇮🇱", "🇮🇹", "🇯🇲", "🇯🇵", "🇯🇴", "🇰🇿", "🇰🇪", "🇰🇬",
        "🇱🇻", "🇱🇧", "🇱🇹", "🇱🇺", "🇲🇾", "🇲🇻", "🇲🇹", "🇲🇽", "🇲🇩", "🇲🇨", "🇲🇳", "🇲🇪", "🇲🇦", "🇳🇵",
        "🇳🇱", "🇳🇿", "🇳🇮", "🇳🇬", "🇰🇵", "🇲🇰", "🇳🇴", "🇵🇰", "🇵🇸", "🇵🇦", "🇵🇾", "🇵🇪", "🇵🇭", "🇵🇱",
        "🇵🇹", "🇶🇦", "🇷🇴", "🇷🇺", "🇸🇦", "🇷🇸", "🇸🇬", "🇸🇰", "🇸🇮", "🇿🇦", "🇰🇷", "🇪🇸", "🇱🇰", "🇸🇪",
        "🇨🇭", "🇸🇾", "🇹🇼", "🇹🇯", "🇹🇭", "🇹🇷", "🇹🇲", "🇺🇦", "🇦🇪", "🇬🇧", "🇺🇸", "🇺🇾", "🇺🇿", "🇻🇦",
        "🇻🇪", "🇻🇳"
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
    endPeek();
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

  function syncActiveEmojiTab(catId) {
    if (!emojiTabsBarEl) return;
    const activeBtn = emojiTabsBarEl.querySelector(`[data-tab-cat="${catId}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
  }

  function scrollToEmojiCategory(catId) {
    selectedEmojiCat = catId;
    isManualScrollingEmoji = true;
    if (manualEmojiScrollTimer) clearTimeout(manualEmojiScrollTimer);
    manualEmojiScrollTimer = setTimeout(() => {
      isManualScrollingEmoji = false;
    }, 450);

    syncActiveEmojiTab(catId);

    if (!emojiScrollEl) return;
    const target = emojiScrollEl.querySelector(`[data-emoji-cat="${catId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleEmojiScroll() {
    if (isManualScrollingEmoji || !emojiScrollEl) return;
    if (emojiScrollRaf) cancelAnimationFrame(emojiScrollRaf);
    emojiScrollRaf = requestAnimationFrame(() => {
      if (!emojiScrollEl) return;
      const containerRect = emojiScrollEl.getBoundingClientRect();
      const blocks = emojiScrollEl.querySelectorAll("[data-emoji-cat]");
      if (!blocks.length) return;

      if (emojiScrollEl.scrollHeight - emojiScrollEl.scrollTop - emojiScrollEl.clientHeight < 24) {
        const lastCat = blocks[blocks.length - 1].getAttribute("data-emoji-cat");
        if (lastCat && selectedEmojiCat !== lastCat) {
          selectedEmojiCat = lastCat;
          syncActiveEmojiTab(lastCat);
        }
        return;
      }

      let activeCat = blocks[0].getAttribute("data-emoji-cat");
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const rect = block.getBoundingClientRect();
        if (rect.top - containerRect.top <= 60) {
          activeCat = block.getAttribute("data-emoji-cat");
        } else {
          break;
        }
      }

      if (activeCat && selectedEmojiCat !== activeCat) {
        selectedEmojiCat = activeCat;
        syncActiveEmojiTab(activeCat);
      }
    });
  }

  async function scrollToSection(secId) {
    selectedSetId = secId;
    if (secId !== "recents" && !$favoriteSetIds.includes(secId)) {
      const idx = recommendedSections.findIndex((s) => s.id === secId);
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
    if (peekTimer) {
      clearTimeout(peekTimer);
      peekTimer = null;
    }
    peekSticker = null;
  }

  function isPluginActive(item, currentTab) {
    if (!currentTab || !currentTab.startsWith("plugin-")) return false;
    const target = currentTab.slice(7);
    return target === String(item.pluginId) ||
           target === String(item.id) ||
           (item.options?.tabId && target === item.options.tabId) ||
           (item.pluginId && target.includes(item.pluginId)) ||
           (item.pluginId && item.pluginId.includes(target));
  }

  function handleModeToggleClick(e) {
    const wrapper = e.target.closest("[data-plugin-tab]");
    if (wrapper) {
      const pTab = wrapper.getAttribute("data-plugin-tab");
      if (pTab) {
        activeTab = "plugin-" + pTab;
        return;
      }
    }
    const btn = e.target.closest("button");
    if (!btn) return;
    const tabId = btn.getAttribute("data-tab-id");
    if (tabId) {
      activeTab = "plugin-" + tabId;
      return;
    }
  }
</script>

<svelte:window on:mouseup={endPeek} on:touchend={endPeek} />

<div class="sticker-panel-wrapper">
  {#if activeTab === "emoji"}
    <div class="emoji-view">
      <div class="emoji-tabs-bar" bind:this={emojiTabsBarEl}>
        <div class="emoji-tabs-inner">
          {#each emojiCategories as cat (cat.id)}
            <button
              type="button"
              class="emoji-tab-item"
              data-tab-cat={cat.id}
              class:selected={selectedEmojiCat === cat.id}
              on:click={() => scrollToEmojiCategory(cat.id)}
              title={cat.name}
            >
              {cat.icon}
            </button>
          {/each}
        </div>
      </div>

      <div class="emoji-scroll-area" bind:this={emojiScrollEl} on:scroll={handleEmojiScroll}>
        <div class="emoji-content-inner">
          {#each emojiCategories as cat (cat.id)}
            <div class="category-block" data-emoji-cat={cat.id}>
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
      </div>
    </div>
  {:else if activeTab === "stickers"}
    <div class="stickers-view">
      <div class="search-bar">
        <div class="search-input-box">
          <span class="mask-icon search-icon" style="-webkit-mask-image: url('/icons/search.svg'); mask-image: url('/icons/search.svg'); width: 16px; height: 16px;"></span>
          <input
            type="text"
            placeholder="Поиск по стикерам"
            value={query}
            on:input={handleQueryChange}
          />
          {#if query}
            <button type="button" class="clear-btn" on:click={clearSearch}>
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 14px; height: 14px;"></span>
            </button>
          {/if}
        </div>
      </div>

      {#if !query}
        <div class="pack-tabs-bar">
          <div class="pack-tabs-inner">
            {#if recentsSection}
              <button
                type="button"
                class="pack-tab-item"
                class:selected={selectedSetId === "recents"}
                on:click={() => scrollToSection("recents")}
                title="Недавние"
              >
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 20px; height: 20px;"></span>
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
              on:click={handleOpenCatalog}
              title="Каталог стикеров"
            >
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/plus.svg'); mask-image: url('/icons/plus.svg'); width: 20px; height: 20px;"></span>
            </button>
          </div>
        </div>
      {/if}

      <div
        class="stickers-content-area"
        bind:this={contentScrollEl}
        on:scroll={handleContentScroll}
      >
        <div class="stickers-content-inner">
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
                    on:contextmenu|preventDefault
                    on:mousedown={() => startPeek(st)}
                    on:mouseup={endPeek}
                    on:touchstart={() => startPeek(st)}
                    on:touchend={endPeek}
                    title={st.tags?.join(", ") || ""}
                  >
                    <StickerMedia
                      url={st.url}
                      lottieUrl={st.lottieUrl}
                      size="100%"
                      autoplay={false}
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
                  on:openPack={(e) => handleOpenPack(e.detail.setId)}
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
                  on:openPack={(e) => handleOpenPack(e.detail.setId)}
                />
              {/each}
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="plugin-tab-view">
      {#each $pluginContents as item (item.id)}
        {#if isPluginActive(item, activeTab)}
          {@html item.html}
        {/if}
      {/each}
    </div>
  {/if}

  <div class="media-keyboard-bottom-panel">
    <div class="bottom-left-actions">
      {#if activeTab === "stickers"}
        <button
          type="button"
          class="bottom-action-btn settings-btn"
          title="Настройки стикеров"
          on:click={handleOpenSettings}
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/settings.svg'); mask-image: url('/icons/settings.svg'); width: 20px; height: 20px;"></span>
        </button>
      {/if}
    </div>

    <div class="bottom-tabs-segmented" on:click={handleModeToggleClick}>
      <button
        type="button"
        class="bottom-tab-pill"
        class:active={activeTab === "emoji"}
        on:click={() => (activeTab = "emoji")}
      >
        <span>Эмодзи</span>
      </button>

      <button
        type="button"
        class="bottom-tab-pill"
        class:active={activeTab === "stickers"}
        on:click={() => (activeTab = "stickers")}
      >
        <span>Стикеры</span>
      </button>

      {#each $pluginTabs as item (item.id)}
        <div class="plugin-tab-btn-wrap" class:active={isPluginActive(item, activeTab)} data-plugin-tab={item.pluginId || item.id}>
          {@html item.html}
        </div>
      {/each}
    </div>

    <div class="bottom-right-actions">
      {#if activeTab === "emoji"}
        <button
          type="button"
          class="bottom-action-btn backspace-btn"
          title="Удалить"
          on:click={() => dispatch("backspace")}
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/backspace.svg'); mask-image: url('/icons/backspace.svg'); width: 20px; height: 20px;"></span>
        </button>
      {:else}
        <button
          type="button"
          class="bottom-action-btn showcase-btn"
          title="Каталог стикеров"
          on:click={handleOpenCatalog}
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/store.svg'); mask-image: url('/icons/store.svg'); width: 20px; height: 20px;"></span>
        </button>
      {/if}
    </div>
  </div>

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
    height: var(--keyboard-height, 290px);
    background: var(--bg-app);
    border-top: 1px solid var(--border-subtle);
    user-select: none;
    position: relative;
    overflow: hidden;
    width: 100%;
    box-sizing: border-box;
  }

  @media (min-width: 601px) {
    .sticker-panel-wrapper {
      height: 340px;
    }
  }

  .plugin-tab-view {
    flex: 1;
    min-height: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    box-sizing: border-box;
  }

  .media-keyboard-bottom-panel {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    min-height: 48px;
    padding: 0 12px;
    background: var(--bg-topbar, var(--bg-surface, #1e2025));
    border-top: 0.5px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    width: 100%;
    box-sizing: border-box;
    flex-shrink: 0;
    z-index: var(--z-panel, 10);
  }

  .bottom-left-actions {
    display: flex;
    align-items: center;
    width: 36px;
    flex-shrink: 0;
  }

  .bottom-action-btn {
    width: 28px;
    height: 28px;
    padding: 4px;
    border: none;
    background: transparent;
    border-radius: 50%;
    color: var(--text-muted, #8e8e93);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
  }

  .bottom-action-btn:hover {
    color: var(--text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.08);
  }

  .bottom-action-btn:active {
    transform: scale(0.92);
  }

  .bottom-tabs-segmented {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    background: transparent;
    padding: 0;
  }

  .bottom-tab-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 14px;
    border: none;
    background: transparent;
    border-radius: 16px;
    color: var(--text-secondary, #8e8e93);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .bottom-tab-pill:hover {
    color: var(--text-primary, #ffffff);
  }

  .bottom-tab-pill.active,
  :global(.plugin-tab-btn-wrap.active .bottom-tab-pill) {
    background: rgba(255, 255, 255, 0.10);
    color: var(--text-primary, #ffffff);
  }

  .plugin-tab-btn-wrap {
    flex-shrink: 0;
  }

  .bottom-right-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    width: 36px;
    flex-shrink: 0;
  }

  .emoji-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .emoji-tabs-bar {
    display: flex;
    align-items: center;
    height: 44px;
    padding: 4px 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-card);
    scrollbar-width: none;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .emoji-tabs-inner {
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    box-sizing: border-box;
  }

  .emoji-tabs-bar::-webkit-scrollbar {
    display: none;
  }

  .emoji-tab-item {
    background: none;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: background-color 0.15s, transform 0.12s;
    flex-shrink: 0;
  }

  .emoji-tab-item:hover {
    background: rgba(255, 255, 255, 0.06);
    transform: scale(1.1);
  }

  .emoji-tab-item.selected {
    background: rgba(255, 255, 255, 0.14);
  }

  .emoji-scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px 54px 16px;
    display: flex;
    flex-direction: column;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .emoji-content-inner {
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .category-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted);
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
    width: 100%;
  }

  .search-bar {
    padding: 8px 12px 6px;
    width: 100%;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .search-input-box {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 8px 12px;
    gap: 8px;
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .search-icon {
    color: var(--text-muted);
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
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pack-tabs-bar {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-card);
    scrollbar-width: none;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .pack-tabs-inner {
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    box-sizing: border-box;
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
    color: var(--text-muted);
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
    color: var(--text-muted);
  }

  .stickers-content-area {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 8px 54px 8px;
    width: 100%;
    box-sizing: border-box;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .stickers-content-inner {
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
  }

  @media (min-width: 601px) {
    .stickers-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }
  }

  .sticker-cell {
    background: none;
    border: none;
    padding: 2px;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1 / 1;
    box-sizing: border-box;
    overflow: hidden;
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
    color: var(--text-muted);
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
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-viewer, 100);
    animation: peekFadeIn 0.15s ease;
    pointer-events: none;
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
