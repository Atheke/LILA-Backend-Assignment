import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production") {
    for (const key of ["VITE_NAKAMA_HOST", "VITE_NAKAMA_PORT", "VITE_NAKAMA_SERVER_KEY", "VITE_NAKAMA_USE_SSL"] as const) {
      if (!env[key]?.trim()) {
        throw new Error(`Missing ${key} for production build. See frontend/.env.example.`);
      }
    }
  }
  return { plugins: [react()] };
});
