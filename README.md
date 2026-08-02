# MTG Scanner

A self-hosted MTG collection manager, deckbuilder, and card scanner.

## Running it

Requires a container runtime (Docker or Podman) with Compose support.

```sh
cp .env.example .env   # defaults are fine as-is
docker compose up -d --build
```

The app is then reachable at `http://localhost:3000` from the host, and at
`http://<host-lan-ip>:3000` from any other device on the same private
network (a phone, for instance). Compose publishes the port on the host's
network interfaces only — nothing here exposes it to the public internet;
that would require an explicit port-forward on your router, which this
setup deliberately does not do.

The SQLite database lives on a named Docker volume (`mtg-data`), so it
survives container restarts and rebuilds. Migrations run automatically on
container start.

On first run the card database is empty - visit the app and click "Sync
now" next to Cards to pull data from Scryfall (takes about half a minute).

## Development

Requires Node 22+ and [pnpm](https://pnpm.io) (`corepack enable` will
provision it from `package.json`'s `packageManager` field). better-sqlite3
compiles a native addon at install time, so run `pnpm install` on the same
platform/arch you'll run the app on.

```sh
pnpm install
pnpm --filter web dev
```

- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm test:e2e` - see
  `docs/adr/` for why the toolchain is shaped the way it is.
- `pnpm --filter web db:generate` - generate a new Drizzle migration after
  editing `apps/web/src/server/db/schema.ts`.

## Project structure

```text
apps/web       Next.js app - UI, API routes, DB access, ingest jobs
apps/worker    GPU inference worker (scanning; not yet implemented)
packages/schemas   Branded ids, Zod schemas, shared domain types
packages/phash     Perceptual hashing (not yet implemented)
docs/adr       Architecture decision records
```
