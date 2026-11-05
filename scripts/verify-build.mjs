import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(import.meta.dirname, "..", "dist");
const baseUrl = new URL("https://site.invalid/my-personal-website/");
const pages = [
  "index.html",
  "project_page.html",
  "timeline_page.html",
  "mkt_agent.html",
  "video_note.html",
];
const requiredOutputs = [
  ...pages,
  "header.html",
  "images/icon3.png",
  "Resume.pdf",
];

await Promise.all(
  requiredOutputs.map((output) => access(resolve(outputDirectory, output))),
);

for (const page of [...pages, "header.html"]) {
  const html = await readFile(resolve(outputDirectory, page), "utf8");
  const pageUrl = new URL(page, baseUrl);

  for (const [, reference] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const url = new URL(reference, pageUrl);
    if (url.origin !== baseUrl.origin) {
      continue;
    }
    if (!url.pathname.startsWith(baseUrl.pathname)) {
      throw new Error(`${page} references a URL outside the repository base: ${reference}`);
    }

    const output = decodeURIComponent(url.pathname.slice(baseUrl.pathname.length));
    await access(resolve(outputDirectory, output)).catch(() => {
      throw new Error(`${page} references a missing build output: ${reference}`);
    });
  }
}

const headerHtml = await readFile(
  resolve(outputDirectory, "header.html"),
  "utf8",
);
for (const page of pages) {
  if (!headerHtml.includes(`href="${page}"`)) {
    throw new Error(`Built shared navigation is missing ${page}`);
  }
}

console.log("Verified GitHub Pages build output.");
