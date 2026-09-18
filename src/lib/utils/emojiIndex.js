class EmojiIndex {
  constructor() {
    this.entries = [];
    this.emojiKeys = new Set();
    this.loading = null;
    this.wordPattern = /[0-9a-zа-яё\-]{2,}/gi;
    this.variationSelector = /\uFE0F/g;
  }

  async ensureLoaded() {
    if (!this.loading) {
      this.loading = this.load();
    }
    return this.loading;
  }

  async load() {
    try {
      const res = await fetch("/data/emoji_keywords.json");
      if (!res.ok) return;
      const data = await res.json();
      for (const [emoji, words] of Object.entries(data)) {
        this.entries.push({
          emoji,
          tokens: words.split(" ")
        });
        this.emojiKeys.add(emoji);
      }
    } catch (e) {
      console.error(e);
    }
  }

  normalize(emoji) {
    return emoji.replace(this.variationSelector, "");
  }

  resolve(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return new Set();

    const targets = new Set();
    const normalized = this.normalize(q);

    for (const key of this.emojiKeys) {
      if (normalized.includes(key)) {
        targets.add(key);
      }
    }

    const words = q.match(this.wordPattern) || [];
    if (!words.length) return targets;

    for (const entry of this.entries) {
      for (const word of words) {
        if (entry.tokens.some(t => t.startsWith(word))) {
          targets.add(entry.emoji);
          break;
        }
      }
    }

    return targets;
  }
}

export const emojiIndex = new EmojiIndex();
