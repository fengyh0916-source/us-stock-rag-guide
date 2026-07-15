import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Built into the Next.js site under /asset-tracker/
const sitePublicOutDir = path.resolve(__dirname, "../../public/asset-tracker");

export default defineConfig({
  plugins: [react()],
  base: "/asset-tracker/",
  build: {
    outDir: sitePublicOutDir,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
