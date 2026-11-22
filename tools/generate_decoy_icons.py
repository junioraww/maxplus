import os
import sys
import json
import random

NOUNS = {
    "calculator": [
        ("Калькулятор", "m"), ("Счётчик", "m"), ("Расчёт", "m"), ("Вычисления", "pl"), ("Таблица", "f"),
        ("Calculator", "en"), ("Calc", "en"), ("Math", "en"), ("Numeric", "en")
    ],
    "notes": [
        ("Заметки", "pl"), ("Блокнот", "m"), ("Записи", "pl"), ("Черновик", "m"), ("Листы", "pl"),
        ("Notes", "en"), ("Notebook", "en"), ("Memo", "en"), ("Pad", "en"), ("Drafts", "en")
    ],
    "todo": [
        ("Задачи", "pl"), ("Планы", "pl"), ("Дела", "pl"), ("Задачник", "m"), ("Список", "m"),
        ("Tasks", "en"), ("Todos", "en"), ("Planner", "en"), ("Agenda", "en"), ("Checklist", "en")
    ],
    "converter": [
        ("Конвертер", "m"), ("Обмен", "m"), ("Переводчик", "m"), ("Единицы", "pl"),
        ("Converter", "en"), ("Units", "en"), ("Exchange", "en"), ("Swap", "en"), ("Rates", "en")
    ]
}

PERSONAL = {
    "m": ["Мой", "Личный", "Свой"],
    "f": ["Моя", "Личная", "Своя"],
    "pl": ["Мои", "Личные", "Свои"],
    "en": ["My", "Personal"]
}

ADJECTIVES = {
    "m": ["Быстрый", "Простой", "Умный", "Точный", "Карманный", "Лёгкий", "Чистый", "Ежедневный", "Рабочий"],
    "f": ["Быстрая", "Простая", "Умная", "Точная", "Карманная", "Лёгкая", "Чистая", "Ежедневная", "Рабочая"],
    "pl": ["Быстрые", "Простые", "Умные", "Точные", "Карманные", "Лёгкие", "Чистые", "Ежедневные", "Рабочие"],
    "en": ["Quick", "Smart", "Fast", "Easy", "Daily", "Pocket", "Clear", "Focus", "Simple"]
}

NEUTRAL_PREFIXES = {
    "ru": ["Мини", "Смарт", "Экспресс", "Супер", "Микро"],
    "en": ["Mini", "Smart", "Express", "Super", "Micro", "Fast", "Quick"]
}

SUFFIXES = ["X", "Pro", "Lite", "Plus", "Go", "One", "Air", "Prime", "Core", "Lab", "Hub", "Kit", "24"]

PALETTES = [
    {"bg": "#121316", "fg": "#FFFFFF", "accent": "#3B82F6"},
    {"bg": "#181A20", "fg": "#F3F4F6", "accent": "#10B981"},
    {"bg": "#0F172A", "fg": "#F8FAFC", "accent": "#38BDF8"},
    {"bg": "#1E1B4B", "fg": "#FFFFFF", "accent": "#818CF8"},
    {"bg": "#2E1065", "fg": "#FAF5FF", "accent": "#C084FC"},
    {"bg": "#064E3B", "fg": "#ECFDF5", "accent": "#34D399"},
    {"bg": "#78350F", "fg": "#FFFBEB", "accent": "#FBBF24"},
    {"bg": "#701A75", "fg": "#FDF4FF", "accent": "#F472B6"},
    {"bg": "#1C1917", "fg": "#FAFAF9", "accent": "#F97316"},
    {"bg": "#0C4A6E", "fg": "#F0F9FF", "accent": "#38BDF8"},
    {"bg": "#14532D", "fg": "#F0FDF4", "accent": "#4ADE80"},
    {"bg": "#831843", "fg": "#FFF1F2", "accent": "#FB7185"},
    {"bg": "#18181B", "fg": "#FFFFFF", "accent": "#A1A1AA"},
    {"bg": "#0284C7", "fg": "#FFFFFF", "accent": "#BAE6FD"},
    {"bg": "#16A34A", "fg": "#FFFFFF", "accent": "#BBF7D0"},
    {"bg": "#EA580C", "fg": "#FFFFFF", "accent": "#FED7AA"},
    {"bg": "#4F46E5", "fg": "#FFFFFF", "accent": "#C7D2FE"},
    {"bg": "#0D9488", "fg": "#FFFFFF", "accent": "#99F6E4"},
    {"bg": "#E11D48", "fg": "#FFFFFF", "accent": "#FECDD3"},
    {"bg": "#475569", "fg": "#F8FAFC", "accent": "#94A3B8"}
]

RADII = [16, 20, 24, 28, 32]

def generate_tree_names(category, count=10, rng=None):
    if rng is None:
        rng = random.Random()
    results = set()
    nouns_list = NOUNS[category]
    attempts = 0
    while len(results) < count and attempts < 300:
        attempts += 1
        noun, gender = rng.choice(nouns_list)
        pattern = rng.choice([1, 2, 3, 4, 5, 6])
        if pattern == 1:
            name = noun
        elif pattern == 2:
            pref = rng.choice(PERSONAL[gender])
            name = f"{pref} {noun}"
        elif pattern == 3:
            suf = rng.choice(SUFFIXES)
            name = f"{noun} {suf}"
        elif pattern == 4:
            adj = rng.choice(ADJECTIVES[gender])
            name = f"{adj} {noun}"
        elif pattern == 5:
            is_en = (gender == "en")
            pref_lang = "en" if is_en else "ru"
            pref = rng.choice(NEUTRAL_PREFIXES[pref_lang])
            name = f"{pref} {noun}"
        elif pattern == 6:
            adj = rng.choice(ADJECTIVES[gender])
            suf = rng.choice(SUFFIXES)
            name = f"{adj} {noun} {suf}"
        results.add(name)
    return sorted(list(results))[:count]

def generate_procedural_glyph(index, fg, accent, rng):
    glyphs = [
        f'<circle cx="54" cy="54" r="30" stroke="{fg}" stroke-width="3.5" fill="none"/><polygon points="54,28 62,54 54,48 46,54" fill="{accent}"/><polygon points="54,80 62,54 54,60 46,54" fill="{fg}" opacity="0.6"/>',
        f'<polygon points="54,20 62,46 88,54 62,62 54,88 46,62 20,54 46,46" fill="{accent}"/><circle cx="54" cy="54" r="6" fill="{fg}"/>',
        f'<rect x="28" y="28" width="52" height="52" rx="12" stroke="{fg}" stroke-width="3.5" fill="none"/><circle cx="54" cy="54" r="12" stroke="{accent}" stroke-width="3" fill="none"/>',
        f'<path d="M54 22C36 22 22 36 22 54C22 72 36 86 54 86C72 86 86 72 86 54" stroke="{fg}" stroke-width="3.5" stroke-linecap="round" fill="none"/><circle cx="54" cy="54" r="14" fill="{accent}"/>',
        f'<line x1="26" y1="54" x2="82" y2="54" stroke="{fg}" stroke-width="3.5" stroke-linecap="round"/><line x1="54" y1="26" x2="54" y2="82" stroke="{fg}" stroke-width="3.5" stroke-linecap="round"/><circle cx="54" cy="54" r="22" stroke="{accent}" stroke-width="3" fill="none"/>',
        f'<polygon points="54,24 82,78 26,78" stroke="{fg}" stroke-width="3.5" stroke-linejoin="round" fill="none"/><circle cx="54" cy="62" r="8" fill="{accent}"/>',
        f'<path d="M34 74C34 74 38 42 74 34C74 34 70 66 34 74Z" fill="{accent}"/><line x1="34" y1="74" x2="62" y2="46" stroke="{fg}" stroke-width="2.5"/>',
        f'<rect x="26" y="32" width="56" height="46" rx="10" stroke="{fg}" stroke-width="3.5" fill="none"/><line x1="26" y1="46" x2="82" y2="46" stroke="{accent}" stroke-width="3"/><circle cx="42" cy="60" r="3" fill="{fg}"/><circle cx="54" cy="60" r="3" fill="{fg}"/><circle cx="66" cy="60" r="3" fill="{fg}"/>',
        f'<path d="M28 54C28 40 40 28 54 28C68 28 80 40 80 54" stroke="{accent}" stroke-width="3.5" fill="none"/><rect x="24" y="52" width="12" height="24" rx="5" fill="{fg}"/><rect x="72" y="52" width="12" height="24" rx="5" fill="{fg}"/>',
        f'<path d="M54 22L32 32V52C32 68 42 80 54 86C66 80 76 68 76 52V32L54 22Z" stroke="{fg}" stroke-width="3.5" fill="none" stroke-linejoin="round"/><circle cx="54" cy="52" r="8" stroke="{accent}" stroke-width="3" fill="none"/>'
    ]
    return glyphs[(index - 1) % len(glyphs)]

def generate_vector_drawable_paths(index, fg, accent):
    idx = (index - 1) % 10 + 1
    if idx == 1:
        return (
            f'    <path android:pathData="M 54,24 a 30,30 0 1,0 0.001,0" android:strokeColor="{fg}" android:strokeWidth="3.5" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 54,28 L 62,54 L 54,48 L 46,54 Z" android:fillColor="{accent}" />\n'
            f'    <path android:pathData="M 54,80 L 62,54 L 54,60 L 46,54 Z" android:fillColor="{fg}" android:fillAlpha="0.6" />'
        )
    elif idx == 2:
        return (
            f'    <path android:pathData="M 54,20 L 62,46 L 88,54 L 62,62 L 54,88 L 46,62 L 20,54 L 46,46 Z" android:fillColor="{accent}" />\n'
            f'    <path android:pathData="M 54,48 a 6,6 0 1,0 0.001,0" android:fillColor="{fg}" />'
        )
    elif idx == 3:
        return (
            f'    <path android:pathData="M 40,28 L 68,28 A 12,12 0 0,1 80,40 L 80,68 A 12,12 0 0,1 68,80 L 40,80 A 12,12 0 0,1 28,68 L 28,40 A 12,12 0 0,1 40,28 Z" android:strokeColor="{fg}" android:strokeWidth="3.5" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 54,42 a 12,12 0 1,0 0.001,0" android:strokeColor="{accent}" android:strokeWidth="3" android:fillColor="#00000000" />'
        )
    elif idx == 4:
        return (
            f'    <path android:pathData="M 54,22 C 36,22 22,36 22,54 C 22,72 36,86 54,86 C 72,86 86,72 86,54" android:strokeColor="{fg}" android:strokeWidth="3.5" android:strokeLineCap="round" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 54,40 a 14,14 0 1,0 0.001,0" android:fillColor="{accent}" />'
        )
    elif idx == 5:
        return (
            f'    <path android:pathData="M 26,54 L 82,54" android:strokeColor="{fg}" android:strokeWidth="3.5" android:strokeLineCap="round" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 54,26 L 54,82" android:strokeColor="{fg}" android:strokeWidth="3.5" android:strokeLineCap="round" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 54,32 a 22,22 0 1,0 0.001,0" android:strokeColor="{accent}" android:strokeWidth="3" android:fillColor="#00000000" />'
        )
    elif idx == 6:
        return (
            f'    <path android:pathData="M 54,24 L 82,78 L 26,78 Z" android:strokeColor="{fg}" android:strokeWidth="3.5" android:strokeLineJoin="round" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 54,54 a 8,8 0 1,0 0.001,0" android:fillColor="{accent}" />'
        )
    elif idx == 7:
        return (
            f'    <path android:pathData="M 34,74 C 34,74 38,42 74,34 C 74,34 70,66 34,74 Z" android:fillColor="{accent}" />\n'
            f'    <path android:pathData="M 34,74 L 62,46" android:strokeColor="{fg}" android:strokeWidth="2.5" android:strokeLineCap="round" android:fillColor="#00000000" />'
        )
    elif idx == 8:
        return (
            f'    <path android:pathData="M 36,32 L 72,32 A 10,10 0 0,1 82,42 L 82,68 A 10,10 0 0,1 72,78 L 36,78 A 10,10 0 0,1 26,68 L 26,42 A 10,10 0 0,1 36,32 Z" android:strokeColor="{fg}" android:strokeWidth="3.5" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 26,46 L 82,46" android:strokeColor="{accent}" android:strokeWidth="3" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 42,57 a 3,3 0 1,0 0.001,0" android:fillColor="{fg}" />\n'
            f'    <path android:pathData="M 54,57 a 3,3 0 1,0 0.001,0" android:fillColor="{fg}" />\n'
            f'    <path android:pathData="M 66,57 a 3,3 0 1,0 0.001,0" android:fillColor="{fg}" />'
        )
    elif idx == 9:
        return (
            f'    <path android:pathData="M 28,54 C 28,40 40,28 54,28 C 68,28 80,40 80,54" android:strokeColor="{accent}" android:strokeWidth="3.5" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 29,52 L 31,52 A 5,5 0 0,1 36,57 L 36,71 A 5,5 0 0,1 31,76 L 29,76 A 5,5 0 0,1 24,71 L 24,57 A 5,5 0 0,1 29,52 Z" android:fillColor="{fg}" />\n'
            f'    <path android:pathData="M 77,52 L 79,52 A 5,5 0 0,1 84,57 L 84,71 A 5,5 0 0,1 79,76 L 77,76 A 5,5 0 0,1 72,71 L 72,57 A 5,5 0 0,1 77,52 Z" android:fillColor="{fg}" />'
        )
    else:
        return (
            f'    <path android:pathData="M 54,22 L 32,32 V 52 C 32,68 42,80 54,86 C 66,80 76,68 76,52 V 32 L 54,22 Z" android:strokeColor="{fg}" android:strokeWidth="3.5" android:strokeLineJoin="round" android:fillColor="#00000000" />\n'
            f'    <path android:pathData="M 54,44 a 8,8 0 1,0 0.001,0" android:strokeColor="{accent}" android:strokeWidth="3" android:fillColor="#00000000" />'
        )

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    static_decoy_dir = os.path.join(root, "static", "decoy")
    os.makedirs(static_decoy_dir, exist_ok=True)

    lib_camo_dir = os.path.join(root, "src", "lib", "camouflage")
    os.makedirs(lib_camo_dir, exist_ok=True)

    android_res_dir = os.path.join(root, "src-tauri", "gen", "android", "app", "src", "main", "res")
    values_dir = os.path.join(android_res_dir, "values")
    drawable_dir = os.path.join(android_res_dir, "drawable")
    mipmap_dir = os.path.join(android_res_dir, "mipmap")
    mipmap_v26_dir = os.path.join(android_res_dir, "mipmap-anydpi-v26")

    for fname in os.listdir(static_decoy_dir):
        if fname.endswith(".png"):
            try:
                os.remove(os.path.join(static_decoy_dir, fname))
            except OSError:
                pass

    if os.path.exists(android_res_dir):
        os.makedirs(values_dir, exist_ok=True)
        os.makedirs(drawable_dir, exist_ok=True)
        os.makedirs(mipmap_dir, exist_ok=True)
        os.makedirs(mipmap_v26_dir, exist_ok=True)

        for folder in os.listdir(android_res_dir):
            if folder.startswith("mipmap-") and folder != "mipmap-anydpi-v26":
                target_folder = os.path.join(android_res_dir, folder)
                if os.path.isdir(target_folder):
                    for fname in os.listdir(target_folder):
                        if fname.startswith("ic_decoy_") and fname.endswith(".png"):
                            try:
                                os.remove(os.path.join(target_folder, fname))
                            except OSError:
                                pass

    force_regenerate = ("--regenerate" in sys.argv) or ("--force" in sys.argv)
    existing_manifest_path = None
    for p in [os.path.join(lib_camo_dir, "decoys.json"), os.path.join(static_decoy_dir, "decoys.json")]:
        if os.path.exists(p):
            existing_manifest_path = p
            break

    icons_meta = []
    color_entries = []
    categories_meta = {}
    xml_strings = []

    if existing_manifest_path and not force_regenerate:
        with open(existing_manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        icons_meta = data.get("icons", [])
        icons_meta.sort(key=lambda x: x.get("index", 0))
        categories_meta = data.get("categories", {})

        for ic in icons_meta:
            idx = ic["index"]
            bg = ic["bg"]
            fg = ic["fg"]
            accent = ic["accent"]
            svg_content = ic["svgContent"]
            svg_filename = f"decoy_{idx}.svg"
            svg_path = os.path.join(static_decoy_dir, svg_filename)
            with open(svg_path, "w", encoding="utf-8") as f:
                f.write(svg_content)

            if os.path.exists(android_res_dir):
                color_entries.append(f'    <color name="decoy_bg_{idx}">{bg}</color>')
                fg_vector = (
                    '<?xml version="1.0" encoding="utf-8"?>\n'
                    '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
                    '    android:width="108dp"\n'
                    '    android:height="108dp"\n'
                    '    android:viewportWidth="108"\n'
                    '    android:viewportHeight="108">\n'
                    f'{generate_vector_drawable_paths(idx, fg, accent)}\n'
                    '</vector>\n'
                )
                with open(os.path.join(drawable_dir, f"ic_decoy_fg_{idx}.xml"), "w", encoding="utf-8") as f:
                    f.write(fg_vector)

                adaptive_xml = (
                    '<?xml version="1.0" encoding="utf-8"?>\n'
                    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                    f'    <background android:drawable="@color/decoy_bg_{idx}" />\n'
                    f'    <foreground android:drawable="@drawable/ic_decoy_fg_{idx}" />\n'
                    '</adaptive-icon>\n'
                )
                with open(os.path.join(mipmap_v26_dir, f"ic_decoy_{idx}.xml"), "w", encoding="utf-8") as f:
                    f.write(adaptive_xml)
                with open(os.path.join(mipmap_dir, f"ic_decoy_{idx}.xml"), "w", encoding="utf-8") as f:
                    f.write(adaptive_xml)

        all_items = []
        for cat_items in categories_meta.values():
            all_items.extend(cat_items)
        all_items.sort(key=lambda x: x.get("aliasIndex", 0))
        for item in all_items:
            alias_idx = item["aliasIndex"]
            clean_label = str(item["label"]).replace('&', '&amp;').replace("'", "\\'")
            xml_strings.append(f'    <string name="decoy_label_{alias_idx}">{clean_label}</string>')
    else:
        rng = random.Random()
        shuffled_palettes = rng.sample(PALETTES, len(PALETTES))

        for idx in range(1, 11):
            pal = shuffled_palettes[(idx - 1) % len(shuffled_palettes)]
            rx = rng.choice(RADII)
            bg = pal["bg"]
            fg = pal["fg"]
            accent = pal["accent"]

            glyph_svg = generate_procedural_glyph(idx, fg, accent, rng)
            svg_content = (
                f'<svg width="108" height="108" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg">\n'
                f'  <rect width="108" height="108" rx="{rx}" fill="{bg}"/>\n'
                f'  {glyph_svg}\n'
                f'</svg>'
            )

            svg_filename = f"decoy_{idx}.svg"
            svg_path = os.path.join(static_decoy_dir, svg_filename)
            with open(svg_path, "w", encoding="utf-8") as f:
                f.write(svg_content)

            if os.path.exists(android_res_dir):
                color_entries.append(f'    <color name="decoy_bg_{idx}">{bg}</color>')

                fg_vector = (
                    '<?xml version="1.0" encoding="utf-8"?>\n'
                    '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
                    '    android:width="108dp"\n'
                    '    android:height="108dp"\n'
                    '    android:viewportWidth="108"\n'
                    '    android:viewportHeight="108">\n'
                    f'{generate_vector_drawable_paths(idx, fg, accent)}\n'
                    '</vector>\n'
                )
                with open(os.path.join(drawable_dir, f"ic_decoy_fg_{idx}.xml"), "w", encoding="utf-8") as f:
                    f.write(fg_vector)

                adaptive_xml = (
                    '<?xml version="1.0" encoding="utf-8"?>\n'
                    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                    f'    <background android:drawable="@color/decoy_bg_{idx}" />\n'
                    f'    <foreground android:drawable="@drawable/ic_decoy_fg_{idx}" />\n'
                    '</adaptive-icon>\n'
                )
                with open(os.path.join(mipmap_v26_dir, f"ic_decoy_{idx}.xml"), "w", encoding="utf-8") as f:
                    f.write(adaptive_xml)
                with open(os.path.join(mipmap_dir, f"ic_decoy_{idx}.xml"), "w", encoding="utf-8") as f:
                    f.write(adaptive_xml)

            icons_meta.append({
                "index": idx,
                "bg": bg,
                "fg": fg,
                "accent": accent,
                "svg": f"decoy/{svg_filename}",
                "svgContent": svg_content
            })

        categories_list = ["calculator", "notes", "todo", "converter"]
        alias_index = 1

        for cat in categories_list:
            names = generate_tree_names(cat, 10, rng)
            cat_items = []
            for i, name in enumerate(names):
                icon_idx = (i % 10) + 1
                cat_items.append({
                    "aliasIndex": alias_index,
                    "iconIndex": icon_idx,
                    "label": name
                })
                clean_name = str(name).replace('&', '&amp;').replace("'", "\\'")
                xml_strings.append(f'    <string name="decoy_label_{alias_index}">{clean_name}</string>')
                alias_index += 1
            categories_meta[cat] = cat_items

    if os.path.exists(values_dir):
        decoy_strings_path = os.path.join(values_dir, "decoy_strings.xml")
        xml_content = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + '\n'.join(xml_strings) + '\n</resources>\n'
        with open(decoy_strings_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

        decoy_colors_path = os.path.join(values_dir, "decoy_colors.xml")
        colors_content = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + '\n'.join(color_entries) + '\n</resources>\n'
        with open(decoy_colors_path, "w", encoding="utf-8") as f:
            f.write(colors_content)

    full_manifest = {
        "icons": icons_meta,
        "categories": categories_meta
    }

    manifest_json_str = json.dumps(full_manifest, indent=2, ensure_ascii=False)

    with open(os.path.join(static_decoy_dir, "decoys.json"), "w", encoding="utf-8") as f:
        f.write(manifest_json_str)

    with open(os.path.join(lib_camo_dir, "decoys.json"), "w", encoding="utf-8") as f:
        f.write(manifest_json_str)

if __name__ == "__main__":
    main()
