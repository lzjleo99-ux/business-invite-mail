# Business Invite Email Assistant / 商务邀约邮件助手

A full-stack cold-outreach workbench for B2B prospecting (built and used for the
Serbia restaurant market). It imports company leads, scrapes/analyses their
websites, generates personalised cold emails, and prepares ready-to-send
**WhatsApp** and **Viber** messages.

- Live UI (static build): <https://lzjleo99-ux.github.io/business-invite-mail/>

> The GitHub Pages link hosts the **front-end only**. Data import, AI generation
> and persistence require the NestJS + database back-end to be running (see
> [Deploying the back-end](#deploying-the-back-end)). Without it the UI loads and
> the language switch works, but API-backed lists show a retry/empty state.

## Features

- **Lead projects** – import companies from `.xlsx`, dedupe, browse/filter,
  stats dashboard, batch delete.
- **AI cold emails** – fluent, logical emails generated in the local language
  **and** English, with subject + body, `.eml` download, mailto, copy and a
  compose/refine editor.
- **WhatsApp _and_ Viber, independently** – whenever a contact has any phone
  number both channels are offered (not either/or):
  - WhatsApp → `https://wa.me/<digits>?text=<encoded message>` (prefilled text).
  - Viber → `https://viber.me/<digits>` opened in a new tab, mirroring the
    reference contact page; the prepared script is copied to the clipboard
    because `viber.me` cannot prefill text.
  - Numbers are normalised to digits (Serbia + generic), landlines are flagged,
    and the WeCom (企业微信) in-app browser is routed through `wxlink://`.
- **Per-channel contact tracking** – separate "contacted on WhatsApp / Viber /
  email" markers.
- **Bilingual UI** – Chinese is the default; an **EN / 中** toggle switches the
  whole interface to English (choice persisted in `localStorage`).
- Email threads / 往来记录, model & sender settings, import secret link.

## Tech stack

NestJS 10 · React 19 · Vite 8 · TypeScript · TanStack Query · React Hook Form +
Zod · Radix UI + Tailwind v4 · Drizzle ORM · `@lark-apaas` full-stack toolkit.

## Getting started (local)

Requires Node.js ≥ 22 and npm ≥ 10.

```bash
npm install        # installs dependencies
npm run dev        # starts Nest (server) + Vite (client) together
```

Other scripts:

```bash
npm run dev:server   # API only (Nest, watch mode)
npm run dev:client   # UI only (Vite)
npm run build        # build server + client (dist/)
npm run build:client # UI only
npm run type:check   # tsc --noEmit for server + client
npm run lint
```

Copy `.env.example` to `.env` if you want to override server/logger settings.
The AI model endpoint/key and the sender profile are configured in the in-app
**Settings** page.

## Project layout

```
client/   React + Vite front-end (pages, components, i18n, api wrappers)
server/   NestJS modules (email generator, website analyzer, projects, …)
shared/   Shared API interfaces/types
scripts/  Dev/build helper scripts
e2e-test/ End-to-end tests
```

## Deploying the front-end to GitHub Pages

The static client is published from the `gh-pages` branch (site root). It is a
single-page app, so `404.html` is a copy of `index.html` (deep-link fallback)
and `.nojekyll` bypasses Jekyll.

```bash
# 1. build with the project sub-path as base
npx vite build --config vite.config.ts --base=/business-invite-mail/
# 2. publish the contents of dist/client/ to the gh-pages branch
```

## Deploying the back-end

The Pages build cannot call `/api/*`. For full functionality host the NestJS
service and its database (the app uses the `@lark-apaas` full-stack runtime /
Drizzle), then point the front-end at that origin. Configure the AI model and
sender in **Settings** after first run.
