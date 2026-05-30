import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "DdlBridgeLib",
      fileName: (format) => `ddl-bridge-lib.${format}.js`
    }
  }
});
