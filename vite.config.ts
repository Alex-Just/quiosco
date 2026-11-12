import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(
      `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: "auto",
      registerType: "autoUpdate",
      manifest: {
        name: "Quiosco",
        short_name: "Quiosco",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#16202a",
        theme_color: "#16202a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        share_target: {
          action: "/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [
              {
                name: "epub",
                accept: ["application/epub+zip", ".epub"],
              },
            ],
          },
        },
        // Bubblewrap turns this into the TWA's VIEW intent filter. Android
        // ignores it for the installed PWA (desktop Chromium honours it), so
        // the APK in android/ is what puts Quiosco in the Open with chooser.
        file_handlers: [
          {
            action: "/add",
            accept: { "application/epub+zip": [".epub"] },
          },
        ],
        // Opening a second book reuses the running reader instead of stacking
        // a new activity and losing the reading position.
        launch_handler: { client_mode: "focus-existing" },
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png}"],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        configure: (proxy) => {
          // Dev-only: the page origin (localhost:5173) differs from the
          // worker's request origin (127.0.0.1:8787), so the worker's /api
          // Origin check would 403 proxied POSTs. Strip the header.
          proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
