import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies /v1 to the API so the browser sees a single origin.
// That keeps CORS out of the picture entirely and makes dev match production,
// where FastAPI serves the built bundle itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
