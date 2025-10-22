import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"), // 配置 @ 指向 src
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      name: "FormPersistence",
      formats: ["es", "umd"],
      fileName: (format) => `form-persistence.${format === 'es' ? 'js' : 'umd.cjs'}`,
    },
    rollupOptions: {
      external: ["vue"],
      output: {
        globals: {
          vue: "Vue",
        },
      },
    },
  },
});
