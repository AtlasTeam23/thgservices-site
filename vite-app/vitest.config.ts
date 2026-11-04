import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Separate from vite.config.ts so the production build never loads test
// tooling. Component tests run in jsdom; pure logic tests run in the same env.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
