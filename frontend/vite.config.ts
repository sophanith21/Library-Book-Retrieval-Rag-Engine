import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Route API requests through the Edge Proxy (Edge Gateway on port 80)
      "/api": {
        target: process.env.VITE_EDGE_PROXY_URL || "http://localhost:80",
        changeOrigin: true,
      },
    },
  },
});
