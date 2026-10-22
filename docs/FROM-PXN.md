# Extracted from PXN

This repository is a **clean slice** of the InnoForge control-plane modules that
previously lived under [luoyanjiang/PXN](https://github.com/luoyanjiang/PXN).

## Migrated inventory

| Source (PXN) | Destination (InnoForge) |
|--------------|-------------------------|
| `apps/control-plane/src/modules/innoforge/*` (except `forge-robot-fk`) | `apps/forge-server/src/modules/innoforge/*` |
| New slim `app` / `server` / `config` | `apps/forge-server/src/{app,server,config}.ts` |
| `apps/forge-console/*` | `apps/forge-console/*` |
| Forge-related SQL (renumbered) | `db/migrations/0001_foundation` … `0003_forge_judgments` |
| `tests/innoforge/*` (robot-fk test omitted) | `tests/innoforge/*` |
| `packages/adapters` + `packages/domain` (minimal) | same |
| `adapters/external/simulator` | same |
| Product mapping doc | README + this file |

## Not migrated

- Full PXN task / dispatch / execution / pilot stack
- `forge-robot-fk.ts` (Postgres robot FK seeding) — replaced by `SimPxnBridge` / optional `HttpPxnBridge`
- PXN OpenAPI / Gate B–C / container delivery contracts

## Bridge model

`createPxnBridge()`:

1. No `PXN_BASE_URL` → `SimPxnBridge` (default, fully offline)
2. `PXN_BASE_URL` set → `HttpPxnBridge` (health probe + sim path IDs with `via: 'http'`)
