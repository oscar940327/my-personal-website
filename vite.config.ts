import { cp, copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const rootDirectory = import.meta.dirname;

function preserveLegacySiteAssets(): Plugin {
  return {
    name: "preserve-legacy-site-assets",
    async closeBundle() {
      const outputDirectory = resolve(rootDirectory, "dist");
      const rootEntries = await readdir(rootDirectory, { withFileTypes: true });
      const legacyAssets = rootEntries
        .filter(
          (entry) =>
            entry.isFile() &&
            (entry.name.endsWith(".css") || entry.name.endsWith(".js")),
        )
        .map((entry) => entry.name);

      await mkdir(outputDirectory, { recursive: true });
      await Promise.all([
        ...legacyAssets.map((asset) =>
          copyFile(resolve(rootDirectory, asset), resolve(outputDirectory, asset)),
        ),
        copyFile(
          resolve(rootDirectory, "header.html"),
          resolve(outputDirectory, "header.html"),
        ),
        copyFile(
          resolve(rootDirectory, "Resume.pdf"),
          resolve(outputDirectory, "Resume.pdf"),
        ),
        cp(resolve(rootDirectory, "images"), resolve(outputDirectory, "images"), {
          recursive: true,
        }),
      ]);
    },
  };
}

export default defineConfig({
  base: "/my-personal-website/",
  plugins: [react(), preserveLegacySiteAssets()],
  server: {
    proxy: {
      "/diary-api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/diary-api/, ""),
      },
    },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        diary: resolve(rootDirectory, "diary.html"),
        home: resolve(rootDirectory, "index.html"),
        journey: resolve(rootDirectory, "timeline_page.html"),
        marketAgent: resolve(rootDirectory, "mkt_agent.html"),
        project: resolve(rootDirectory, "project_page.html"),
        videoNote: resolve(rootDirectory, "video_note.html"),
      },
    },
  },
});
