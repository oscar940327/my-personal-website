import { resolve } from "node:path";

import { defineConfig } from "vite";

const rootDirectory = import.meta.dirname;

export default defineConfig({
  base: "/my-personal-website/",
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(rootDirectory, "index.html"),
        journey: resolve(rootDirectory, "timeline_page.html"),
        marketAgent: resolve(rootDirectory, "mkt_agent.html"),
        project: resolve(rootDirectory, "project_page.html"),
        videoNote: resolve(rootDirectory, "video_note.html"),
      },
    },
  },
});
