/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy so the browser talks to the FastAPI backend without CORS friction.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Override with VIBEAPP_API when the backend isn't on the default port.
      "/api": process.env.VIBEAPP_API || "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // Type-only and entry/bootstrap files carry no testable logic.
      exclude: ["src/types.ts", "src/main.tsx", "src/vite-env.d.ts", "src/test/**"],
    },
  },
});
