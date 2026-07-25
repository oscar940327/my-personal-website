import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(import.meta.dirname, "..", "dist");
const requiredOutputs = [
  "index.html",
  "project_page.html",
  "timeline_page.html",
  "mkt_agent.html",
  "video_note.html",
  "diary.html",
  "header.html",
  "header_style.css",
  "header-placeholder.js",
  "images/icon3.png",
  "Resume.pdf",
];

await Promise.all(
  requiredOutputs.map((output) => access(resolve(outputDirectory, output))),
);

const diaryHtml = await readFile(
  resolve(outputDirectory, "diary.html"),
  "utf8",
);
if (!diaryHtml.includes("/my-personal-website/assets/")) {
  throw new Error("Diary build does not use the GitHub Pages repository base");
}

const headerHtml = await readFile(
  resolve(outputDirectory, "header.html"),
  "utf8",
);
if (!headerHtml.includes('href="diary.html">DIARY</a>')) {
  throw new Error("Built shared navigation is missing DIARY");
}

console.log("Verified GitHub Pages build output.");
