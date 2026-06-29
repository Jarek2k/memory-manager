import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" → relative asset URLs so the built dist/ can be served from any
// path by the tiny Python server. No external network at runtime.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2020" },
  server: { port: 5173 },
});
