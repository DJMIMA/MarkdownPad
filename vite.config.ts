import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    // Rust build output lives under src-tauri/target. Watching it is useless
    // for the frontend, and on Windows cargo keeps the fresh .exe/.dll/.pdb
    // files locked, so every lock printed a "file watcher error: EBUSY" line
    // during `npm run tauri dev`. Same setting as the Tauri project template.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  // The app only ever runs inside the bundled WebView2 (modern Chromium), so
  // we can target esnext and skip legacy transforms for smaller, faster output.
  build: {
    target: "esnext",
  },
});

