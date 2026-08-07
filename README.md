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

### Phone camera over LAN (HTTPS)

iOS Safari only allows the camera in a secure context. For local smoke:

```sh
./scripts/mint-lan-certs.sh          # once per LAN IP change
./scripts/serve-dev-ca.sh            # leave running; install CA on the phone
# in the node container / on a machine with Node:
pnpm --filter web dev:lan
```

1. On the phone open `http://<lan-ip>:3080/rootCA.pem` → Install the profile.
2. Settings → General → About → Certificate Trust Settings → enable **MTG Scanner Dev CA**.
3. Open `https://<lan-ip>:3000/scan` (not `http`).

`apps/web/next.config.ts` already allows the LAN host in `allowedDevOrigins` so
the Next 16 client bundle hydrates when you are not on `localhost`.

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

## Backup & Restore

Trigger a backup at any time - the app stays fully up and serving requests
the whole time (it uses SQLite's online backup API, not a raw file copy):

```sh
curl -X POST http://localhost:3000/api/backup
```

This writes a timestamped, self-contained snapshot (`mtg-backup-<ISO
timestamp>.db`) to `BACKUP_DIR` (default: a `backups/` folder next to the
live database - inside the `mtg-data` volume for the Compose setup, so it
survives container restarts alongside the DB it's backing up). For real
disaster-recovery coverage - not just "I fat-fingered a delete" - copy
backup files off the volume periodically, e.g.:

```sh
docker compose cp web:/data/backups/<file> ./local-backups/
```

### Restoring

Restoring **must** happen with the app stopped - a live process holds the
database's WAL file open, and writing underneath it would just get
overwritten on the next checkpoint.

```sh
docker compose stop web
docker compose run --rm -e DATABASE_PATH=/data/mtg.db web \
  node --experimental-strip-types src/server/db/restore-cli.ts /data/backups/<file>
docker compose start web
```

Outside Compose (local dev), the same script works directly:

```sh
DATABASE_PATH=./apps/web/data/mtg.db \
  node --experimental-strip-types apps/web/src/server/db/restore-cli.ts <backup-file>
```

This has been run for real (KAD-15) - not just covered by a mocked test -
against a live instance: seed data through the running API, back it up
while the app kept serving requests, restore that file into a completely
separate fresh instance, and confirm the two instances' collection data
matched exactly.

## Project structure

```text
apps/web       Next.js app - UI, API routes, DB access, ingest jobs
apps/worker    GPU inference worker (scanning; not yet implemented)
packages/schemas   Branded ids, Zod schemas, shared domain types
packages/phash     Perceptual hashing (not yet implemented)
docs/adr       Architecture decision records
```
