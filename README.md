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

This starts the Vite dev server (port 5173) and Wrangler (port 8787) in parallel. The frontend proxies `/api/*` to the worker. Open http://localhost:5173 to see the feed.

### NixOS

On NixOS, the npm-installed `workerd` binary can't run because it's dynamically linked for generic Linux. A `shell.nix` is provided that:

- Patches the `workerd` binary with a working nix-provided version
- Sets `SSL_CERT_DIR` so workerd's BoringSSL trusts TLS certificates
- Provides `node`, `pnpm`, and `wrangler`

```bash
nix-shell
pnpm install   # first time only
pnpm dev
```

The `shellHook` patches `workerd` automatically on each shell entry. You only need `pnpm install` once (or after lockfile changes).

## Environment variables

The worker needs these secrets at runtime:

| Variable | Purpose |
|----------|---------|
| `TAVILY_API_KEY` | Tavily search API key |
| `ZAI_API_KEY` | Z.AI API key for LLM |

For local development, these are read from `apps/worker/.dev.vars` (gitignored). See `apps/worker/.dev.vars.example` for the template.

For production, set them via `wrangler secret put`.

## Deploy

### First deploy

1. Log in to Cloudflare:
   ```bash
   npx wrangler login
   ```
   This opens a browser for OAuth. Alternatively, set a `CLOUDFLARE_API_TOKEN` env var.

2. Set production secrets (pick one):

   **Option A:** Push from `.dev.vars` (recommended if you already have local dev working):
   ```bash
   ./scripts/push-secrets.sh
   ```

   **Option B:** Set interactively:
   ```bash
   cd apps/worker
   npx wrangler secret put TAVILY_API_KEY
   npx wrangler secret put ZAI_API_KEY
   ```

3. Deploy:
   ```bash
   cd ../..
   pnpm deploy
   ```
   This builds the frontend, bundles it as worker assets, and deploys everything.
   The worker goes live at `https://web-explorer.<account-subdomain>.workers.dev`.

4. Smoke test:
   ```bash
   # Quick check (infrastructure only):
   ./scripts/smoke-test.sh https://web-explorer.<account-subdomain>.workers.dev

   # Deep check (waits for a live exploration card, ~60s):
   ./scripts/smoke-test.sh https://web-explorer.<account-subdomain>.workers.dev --deep
   ```

### Subsequent deploys

```bash
pnpm deploy
```

Secrets persist across deploys. Only code and assets are updated.

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
