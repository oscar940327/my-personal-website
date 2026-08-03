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
  React and TypeScript Diary page. Its pre-created owner signs in through a
  Supabase Magic Link before the page exposes the protected FastAPI shell.

## Features

- Clean personal portfolio style
- Light and dark mode
- Smooth scrolling
- Project image scroll transition
- Timeline for project history
- Responsive layout for desktop and mobile
- Shared `DIARY` navigation below `JOURNEY` and above `MktAgent`
- Explicit Entry action for changing Entry Time without changing Captured time
  or immutable Original Content revisions
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
- The sibling Diary repository's local Supabase stack running

Copy `.env.example` to `.env.local`, then replace
`VITE_SUPABASE_PUBLISHABLE_KEY` with the local publishable key shown by
`npm.cmd run supabase -- status -o env` in the Diary repository. This key and
the Supabase URL are intentionally public browser configuration.

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/my-personal-website/diary.html`.

During local development, Vite proxies `/diary-api` to
`http://127.0.0.1:8000`, so the browser can reach the separately running API
while FastAPI separately allows the local Vite origins.

`VITE_DIARY_API_URL`, `VITE_SUPABASE_URL`, and
`VITE_SUPABASE_PUBLISHABLE_KEY` are public browser values. Do not put a
Supabase service-role key, JWT private key or secret, database credential, AI
provider key, Azure secret, or container-registry credential in any Vite
variable.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run verify:build
```

The production build uses the `/my-personal-website/` GitHub Pages base and
retains the existing HTML pages, scripts, styles, images, and resume.

The Pages workflow reads three GitHub Actions repository variables:

- `DIARY_API_URL`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Their checked-in fallbacks contain no credential and keep pull-request builds
testable. Configure the real public values before using the deployed Diary
authentication flow.
- Google Fonts

## Contact

- Email: oscar940327@gmail.com
- GitHub: [oscar940327](https://github.com/oscar940327)

---

Built by Oscar Cheng for personal learning and portfolio use.
