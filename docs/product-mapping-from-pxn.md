> **Note:** Product home is now this repository ([InnoForge](https://github.com/luoyanjiang/InnoForge)).
> The PXN copy of this doc is a deprecated pointer. Run instructions below are superseded by the root README.

# InnoForge on PXN — module mapping & runnable slice

**Status:** living  
**Scope:** map Intent OS × InnoForge closed loop onto PXN modules; ship a governed API + console slice.

## 1. Product loop → PXN modules

| Loop stage | Product meaning | PXN module / extension |
|------------|-----------------|------------------------|
| Create intent + Credit stake | Expression has cost | **NEW** `modules/innoforge` Credit ledger + `POST /v1/forge/intents` (optional `pxn_task_id` links to existing `task-intents`) |
| Twin / Agent adopt-reject | Proposal ≠ command | Existing `task-intents` + `task_revisions` (OntOS grounding); forge UI does not bypass PTC |
| Human confirm / governance | Human sovereignty | Existing `approvals` pattern; forge `POST .../confirm` is the InnoForge confirm gate before physical egress |
| Preflight / policy | Fail closed | Existing `preflight` / `policy` for PTC path; forge deploy refuses without confirm |
| Controlled deploy gateway | Physical egress | **NEW** `forge-robot-fk` writes real `route_quotes`/`dispatches`/`executions` after confirm; **NEW** `ExternalAdapter` registry alongside |
| Evidence / acceptance | Verified outcome | Existing `evidence` + `acceptance`; forge `feedback` ticks adapter jobs then settles |
| Credit mint / attribution | Value realization | **NEW** forge Credit settle on adapter `SUCCEEDED` (simulator 1.5× stake) |
| External systems | Pluggable providers | **NEW** `packages/adapters/src/external-adapter.ts` + `adapters/external/simulator` (27 simulators; Real placeholder) |

## 2. UI alignment (designed IA on PXN)

`/forge` is now the **designed product shell** (dark Intent OS sidebar IA), not a thin form:

总览 · 工作台 · 协作 · 发现 · 创建意图 · 部署 · 市场 · 账号 · 外部连接 · 治理 · 权益 — zh/en chrome, wired to `/v1/forge/*`.

**Genesis polish now on PXN:** R3F 3D (collab + lifeform), tenant SSE negotiate/governance rooms, partner webhook config/receiver/Deploy feedback.

**Robot FK:** `forge-robot-fk.ts` + `pxn-bridge` — deploy seeds site/robot/policy/world and inserts real `preflight_runs` → `route_quotes` → `dispatches` → `executions` (human confirm still gates exit).

## 3. What stayed in genesis vs moved to PXN

| Stays in genesis (UI reference only) | Moved / implemented on PXN |
|--------------------------------------|----------------------------|
| Full Next.js app-router shell | Designed IA SPA on control-plane `/forge` |
| Marketplace Stripe production polish | Sandbox checkout + Credit top-up; partner webhook sim path |
| Wholesale paste of genesis | Adapter registry, R3F scenes, SSE rooms, partner gateway on PXN |

## 4. Run

```bash
docker compose up -d --wait postgres   # or local Postgres
npm ci --ignore-scripts --no-audit --no-fund
DATABASE_URL=postgres://pxn:pxn_dev_only@127.0.0.1:5432/pxn npm run db:migrate
DATABASE_URL=postgres://pxn:pxn_dev_only@127.0.0.1:5432/pxn npm run dev:control-plane
```

- Health: `curl --fail http://127.0.0.1:3000/healthz`
- Console: `http://127.0.0.1:3000/forge`
- Tests: `npm run innoforge:test`

## 5. Invariants preserved

1. Natural language never becomes a raw physical command.
2. Deploy requires explicit human confirm.
3. External systems default to **Simulator**; Real requires credentials later.
4. Domain events + outbox emitted for forge state changes (Postgres path).
5. UI chrome is locale-pure (zh **or** en), not mixed.
