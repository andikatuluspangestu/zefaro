import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base: the built folder works at the domain root or in a subfolder.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2020", cssCodeSplit: false },
});
