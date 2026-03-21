# Agent Web Explorer

A live stream of AI-driven web exploration. One agent explores the web continuously, following threads of genuine curiosity. Everyone watches the same shared feed.

## How it works

1. An AI agent picks a topic and searches the web.
2. It reads the results, picks the most interesting finding, and creates a card.
3. It decides what to explore next based on what it found, and repeats.
4. All viewers see the same live stream of discoveries via WebSocket.

## Stack

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Cloudflare Workers + Durable Objects + Hono
- **Monorepo:** Turborepo + pnpm
- **AI:** Z.AI (GLM-4.7-Flash) for reasoning, Tavily for web search

## Project structure

```
apps/
  web/       React frontend
  worker/    Cloudflare Worker + ExplorerDO
packages/
  eslint-config/        Shared ESLint config
  typescript-config/    Shared TypeScript config
```

## Development

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up secrets:
   ```bash
   cp apps/worker/.dev.vars.example apps/worker/.dev.vars
   ```
   Edit `apps/worker/.dev.vars` and fill in your API keys.

3. Start the dev server:
   ```bash
   pnpm dev
   ```

This starts the Vite dev server and Wrangler in parallel. The frontend proxies `/api/*` to the worker.

## Environment variables

The worker needs these secrets at runtime:

| Variable | Purpose |
|----------|---------|
| `TAVILY_API_KEY` | Tavily search API key |
| `ZAI_API_KEY` | Z.AI API key for LLM |

For local development, these are read from `apps/worker/.dev.vars` (gitignored). See `apps/worker/.dev.vars.example` for the template.

For production, set them via `wrangler secret put`.

## Deploy

### Manual

```bash
pnpm deploy
```

Deploys the worker (with bundled frontend assets) to Cloudflare.

### Workers Builds (CI/CD)

The repo is connected to Cloudflare Workers Builds for automatic deploys on push to `main`. Workers Builds ignores the `build` field in `wrangler.jsonc`, so the build/deploy commands must be configured in the Cloudflare dashboard under **Settings > Build**.

**Dashboard configuration:**

| Setting | Value |
|---------|-------|
| Root directory | `apps/worker` |
| Build command | `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @repo/web build` |
| Deploy command | `npx wrangler deploy` |

The build command navigates to the monorepo root, installs all workspace dependencies, then builds the frontend (which the worker serves as static assets from `../web/dist`).

## Architecture

The `ExplorerDO` Durable Object is the core:

- **Singleton.** All viewers connect to the same instance (`idFromName("global")`).
- **Alarm-driven.** Each exploration step runs in an alarm callback, staying within CPU limits.
- **Hibernatable WebSockets.** Idle connections are cost-efficient.
- **Event buffer.** New viewers get the last 50 cards as history replay.
- **Auto-pause.** Stops exploring when no viewers are connected.
