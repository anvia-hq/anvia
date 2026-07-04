import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5177),
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
