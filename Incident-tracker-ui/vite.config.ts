import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxying rather than making the client base-URL aware: src/api/client.ts is
    // the only fetch in the codebase by constitution, and it uses relative paths
    // so that production can serve both from one origin. Same-origin in dev too.
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
