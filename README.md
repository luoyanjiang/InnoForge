# InnoForge

Standalone **Intent OS × InnoForge** control plane and `/forge` console.

Product development lives here. The earlier PXN-hosted slice remains in
[luoyanjiang/PXN](https://github.com/luoyanjiang/PXN) for compatibility only
(see `docs/product/07-innoforge-on-pxn.md` there).

## What this repo is

| Piece | Path |
|-------|------|
| Forge API + server | `apps/forge-server` |
| Console SPA | `apps/forge-console` → served at `/forge` |
| Migrations | `db/migrations` (`0001`–`0003`) |
| External adapter sims | `adapters/external/simulator` + `packages/adapters` |
| Tests | `tests/innoforge` |

PXN robot scheduling is **optional**:

- Default: `SimPxnBridge` (local path IDs, no PXN process)
- Optional: set `PXN_BASE_URL` (e.g. `http://127.0.0.1:3000`) for `HttpPxnBridge`

## Prerequisites

- Node.js ≥ 22.13
- PostgreSQL 16 (Docker Compose or local)

## Clone & run

```bash
git clone https://github.com/luoyanjiang/InnoForge.git
cd InnoForge
npm install --ignore-scripts --no-audit --no-fund

# Postgres (Docker) — or create DB/user locally
docker compose up -d --wait postgres
export DATABASE_URL='postgresql://innoforge:innoforge_dev_only@127.0.0.1:5432/innoforge'

# Local Postgres without Docker:
# sudo -u postgres createuser -s innoforge  # or your role
# createdb -O innoforge innoforge
# export DATABASE_URL='postgresql://innoforge@127.0.0.1:5432/innoforge'

npm run db:migrate
npm run dev
# Console: http://127.0.0.1:3080/forge
# Health:  http://127.0.0.1:3080/healthz
```

Optional PXN bridge:

```bash
export PXN_BASE_URL='http://127.0.0.1:3000'   # running PXN control-plane
npm run dev
```

## Local CI

No GitHub required checks. Merge gate is local:

```bash
npm run local:ci   # typecheck + innoforge:test
```

## Origin

Clean slice from PXN `main` (forge modules only — not full PXN history).
See [docs/FROM-PXN.md](docs/FROM-PXN.md).
