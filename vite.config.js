import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      $components: path.resolve("./src/components"),
    },
  },

  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toLocaleDateString("ru-RU"))
  },

  build: {
    cssCodeSplit: false,

    chunkSizeWarningLimit: 2000,

    rollupOptions: {
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
}));
