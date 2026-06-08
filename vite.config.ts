import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  // The app only ever runs inside the bundled WebView2 (modern Chromium), so
  // we can target esnext and skip legacy transforms for smaller, faster output.
  build: {
    target: "esnext",
  },
});

