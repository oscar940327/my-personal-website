# Oscar's Personal Website

This is my personal website for introducing myself, showing my projects, and recording my learning journey.

Website: https://oscar940327.github.io/my-personal-website/

## Pages

- `index.html`  
  Home page with a short introduction, motivation, skills, and contact information.

- `project_page.html`  
  Project showcase with selected AI and software projects.

- `timeline_page.html`  
  Timeline of important learning and project milestones.

- `mkt_agent.html`
  Market Agent demo.

- `video_note.html`
  VideoNote demo.

## Project structure

The HTML entry pages stay in the repository root to preserve their URLs.
Page-specific JavaScript and CSS live together under `src/pages/`:

```text
src/
  pages/
    home/
    projects/
    journey/
    market-agent/
    video-note/
  shared/
    header.js
    header.css
    smooth-scroll.js
public/
  header.html
  images/
  Resume.pdf
scripts/
  verify-build.mjs
```

`src/shared/` contains behavior and styles used across pages. `public/`
contains files served at stable URLs, including the shared navigation HTML,
images, and resume. Vite bundles the JS and CSS referenced by each HTML entry
and copies `public/` into `dist/` automatically.

## Features

- Clean personal portfolio style
- Light and dark mode
- Smooth scrolling
- Project image scroll transition
- Timeline for project history
- Responsive layout for desktop and mobile
- Vite multi-page build that preserves the existing static pages and assets

## Tech Stack

- HTML
- CSS
- JavaScript
- TypeScript
- Vite
- Google Fonts

## Local development

Requirements:

- Node.js 24 or newer

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/my-personal-website/`.

## Verification

```powershell
npm.cmd test
```

The production build uses the `/my-personal-website/` GitHub Pages base and
retains the existing HTML pages, scripts, styles, images, and resume.

`npm.cmd test` type-checks the build configuration, builds the site, and verifies
the preserved pages, shared navigation, and assets.

## Contact

- Email: oscar940327@gmail.com
- GitHub: [oscar940327](https://github.com/oscar940327)

---

Built by Oscar Cheng for personal learning and portfolio use.
