export async function getAvailableFonts() {
  const fallbackFamilies = [
    { label: "Системный", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
    { label: "Inter", family: "'Inter', sans-serif" },
    { label: "Roboto", family: "'Roboto', sans-serif" },
    { label: "Segoe UI", family: "'Segoe UI', sans-serif" },
    { label: "San Francisco", family: "system-ui, -apple-system, sans-serif" },
    { label: "Ubuntu", family: "'Ubuntu', sans-serif" },
    { label: "JetBrains Mono", family: "'JetBrains Mono', monospace" },
    { label: "Monospace", family: "'Courier New', Courier, monospace" },
    { label: "Georgia", family: "'Georgia', 'Times New Roman', serif" },
    { label: "Serif", family: "'Times New Roman', Times, serif" },
    { label: "Impact", family: "'Impact', 'Arial Black', sans-serif" },
    { label: "Cursive", family: "'Comic Sans MS', 'Caveat', cursive" }
  ];

  if (typeof window === "undefined") return fallbackFamilies;

  if ("queryLocalFonts" in window) {
    try {
      const localFonts = await window.queryLocalFonts();
      if (Array.isArray(localFonts) && localFonts.length > 0) {
        const unique = new Map();
        for (const font of localFonts) {
          if (font.family && !unique.has(font.family)) {
            unique.set(font.family, {
              label: font.family,
              family: `"${font.family}", sans-serif`
            });
          }
        }
        if (unique.size > 0) {
          return [
            fallbackFamilies[0],
            ...Array.from(unique.values()).slice(0, 30)
          ];
        }
      }
    } catch {}
  }

  const detected = [fallbackFamilies[0]];
  const testString = "mmmmmmmmmmlli";
  const testSize = "72px";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallbackFamilies;

  const getWidth = (font) => {
    ctx.font = `${testSize} ${font}`;
    return ctx.measureText(testString).width;
  };

  const monoWidth = getWidth("monospace");
  const sansWidth = getWidth("sans-serif");
  const serifWidth = getWidth("serif");

  for (let i = 1; i < fallbackFamilies.length; i++) {
    const item = fallbackFamilies[i];
    const candidate = item.family.split(",")[0].replace(/['"]/g, "").trim();
    const w1 = getWidth(`"${candidate}", monospace`);
    const w2 = getWidth(`"${candidate}", sans-serif`);
    const w3 = getWidth(`"${candidate}", serif`);
    if (w1 !== monoWidth || w2 !== sansWidth || w3 !== serifWidth) {
      detected.push(item);
    }
  }

  return detected.length > 1 ? detected : fallbackFamilies;
}
