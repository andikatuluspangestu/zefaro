import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from the domain root: pages live at /, /id/ and /id/<guide>/, and all of them load
// the same /assets/ files.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: { target: "es2020", cssCodeSplit: false },
});
