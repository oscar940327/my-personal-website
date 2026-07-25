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

- `diary.html`
  React and TypeScript Diary page. It calls the separately running FastAPI
  readiness endpoint before later Diary tickets add authenticated records.

## Features

- Clean personal portfolio style
- Light and dark mode
- Smooth scrolling
- Project image scroll transition
- Timeline for project history
- Responsive layout for desktop and mobile
- Shared `DIARY` navigation below `JOURNEY` and above `MktAgent`
- Vite multi-page build that preserves the existing static pages and assets

## Tech Stack

- HTML
- CSS
- JavaScript
- React
- TypeScript
- Vite
- Playwright

## Local development

Requirements:

- Node.js 24 or newer
- The Diary FastAPI service running at `http://127.0.0.1:8000`

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/my-personal-website/diary.html`.

During local development, Vite proxies `/diary-api` to
`http://127.0.0.1:8000`, so the browser can reach the separately running API
without requiring production CORS policy in this ticket.

`VITE_DIARY_API_URL` is a public backend URL, not a secret. Do not put database,
AI provider, Azure, or authentication secrets in Vite variables.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run verify:build
```

The production build uses the `/my-personal-website/` GitHub Pages base and
retains the existing HTML pages, scripts, styles, images, and resume.

The Pages workflow expects an optional repository variable named
`DIARY_API_URL`. Until the production FastAPI URL exists, its non-secret
placeholder makes the Diary page show the designed unavailable state.
- Google Fonts

## Contact

- Email: oscar940327@gmail.com
- GitHub: [oscar940327](https://github.com/oscar940327)

---

Built by Oscar Cheng for personal learning and portfolio use.
