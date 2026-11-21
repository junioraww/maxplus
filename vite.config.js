import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

async function ensureDecoyAssets() {
  try {
    const fs = await import("node:fs");
    const decoysJson = path.resolve("./src/lib/camouflage/decoys.json");
    if (!fs.existsSync(decoysJson)) {
      try {
        const cp = await import("node:child_process");
        cp.execSync("python3 tools/generate_decoy_icons.py", { stdio: "inherit" });
      } catch {}
      if (!fs.existsSync(decoysJson)) {
        const fallback = {
          icons: [{ index: 1, bg: "#181A20", fg: "#FFFFFF", accent: "#3B82F6", svg: "", png: "", svgContent: "<svg></svg>" }],
          categories: {
            calculator: [{ aliasIndex: 1, iconIndex: 1, label: "Калькулятор" }],
            notes: [{ aliasIndex: 11, iconIndex: 1, label: "Заметки" }],
            todo: [{ aliasIndex: 21, iconIndex: 1, label: "Задачи" }],
            converter: [{ aliasIndex: 31, iconIndex: 1, label: "Конвертер" }]
          }
        };
        fs.mkdirSync(path.dirname(decoysJson), { recursive: true });
        fs.writeFileSync(decoysJson, JSON.stringify(fallback, null, 2));
      }
    }
  } catch {}
}

export default defineConfig(async () => {
  await ensureDecoyAssets();
  return {
    plugins: [sveltekit()],
  resolve: {
    alias: {
      $components: path.resolve("./src/components"),
    },
  },

  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toLocaleDateString("ru-RU")),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "0.1.5"),
  },

  build: {
    cssCodeSplit: false,

    chunkSizeWarningLimit: 2000,

    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE_INTO_ANOTHER_CHUNK") {
          return;
        }
        if (process.env.VITE_FAIL_ON_WARNINGS === "true") {
          throw new Error(`[vite:warning] ${warning.message || warning}`);
        }
        warn(warning);
      },
      output: {
        manualChunks: (id) => {
          if (id.includes("lottie-web")) {
            return "lottie";
          }
        },
      },
    },

    modulePreload: { polyfill: false },
  },

  css: {
    devSourcemap: true,
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
};
});
