---
name: dev-container
description: Run pnpm/node commands in the long-lived mtg-dev Podman container used by this repo. Use when installing deps, running scripts, or when host Node is missing/immutable Fedora.
---

# Dev container

Host has **no Node** on the immutable Fedora-family setup. All node/pnpm work goes through a long-lived container (not a fresh one per command).

## Ensure container

```sh
podman ps --filter name=mtg-dev --format '{{.Names}} {{.Status}}'
```

If missing:

```sh
podman run -d --name mtg-dev \
  -v "$(pwd)":/workspace:Z \
  -w /workspace \
  node:22 sleep infinity
```

`:Z` is required for SELinux volume labels.

## Run commands

```sh
podman exec mtg-dev sh -c "cd /workspace && corepack enable && <command>"
```

Examples:

```sh
podman exec mtg-dev sh -c "cd /workspace && pnpm install"
podman exec mtg-dev sh -c "cd /workspace && pnpm lint && pnpm lint:biome && pnpm typecheck"
podman exec mtg-dev sh -c "cd /workspace && pnpm test"
```

## Compose / image builds

For anything touching `Dockerfile` / `docker-compose.yml`, use Compose (Podman shells out to the docker-compose plugin):

```sh
podman compose up -d --build
# or: docker compose up -d --build
```

Some bugs only show in the real image (pnpm workspace symlink layout).

## Notes

- Prefer reusing `mtg-dev` over `podman run --rm` per invocation.
- `pnpm` version comes from `packageManager` via `corepack enable`.
- If the user already has working host Node (e.g. nvm), host `pnpm` is fine — still use Compose for image verification.
