# Tasko M0 Runbook

## Profiles and services

The same source tree supports `DEPLOYMENT_PROFILE=single_tenant` and `DEPLOYMENT_PROFILE=saas`. In the single-tenant profile, `TASKO_SINGLE_TENANT_SLUG` is selected by the server and no browser workspace selector is treated as authority. In SaaS, a browser may request a slug but the server resolves it only if the authenticated user has an active membership.

| Concern | Environment variable | Development fallback | Production requirement |
|---|---|---|---|
| PostgreSQL | `TASKO_POSTGRES_URL` | In-memory adapter for tests/local UI | Required durable source of truth |
| Redis | `TASKO_REDIS_URL` | In-process pub/sub adapter | Required for multi-instance realtime fan-out |
| Deployment profile | `DEPLOYMENT_PROFILE` | `single_tenant` | `single_tenant` or `saas` |
| Primary workspace | `TASKO_SINGLE_TENANT_SLUG` | `tasko-demo` | Required for OSS profile |
| Worker | `TASKO_WORKER_POLL_MS`, `TASKO_WORKER_MAX_ATTEMPTS` | 1s / 8 attempts | Dedicated worker process |

## PostgreSQL bootstrap

Install PostgreSQL with `pgcrypto` available, provide `TASKO_POSTGRES_URL`, then run `pnpm db:platform:migrate`. The migration creates `tenants`, `users`, `tenant_members`, tenant-owned operational tables, transactional outbox, audit logs, and PostgreSQL RLS policies based on `app.tenant_id`.

Set `OWNER_OPEN_ID` and run `pnpm db:platform:seed` to create the demo owner and the `tasko-demo` workspace. The seed is idempotent and can be safely re-run.

## Runtime model

The HTTP process exposes `/health` for liveness and `/ready` for readiness. Health evaluates the database, Redis and worker state; readiness returns HTTP 503 if a configured dependency is not healthy. The WebSocket gateway accepts `/api/realtime` upgrades only after verifying the session and resolving an active membership. Subscriptions are tenant-scoped and reject a mismatched tenant ID.

Run `pnpm worker` in a dedicated process to poll the PostgreSQL outbox. Each durable mutation must be created through the outbox service, which writes its audit entry and event in the same transaction. The consumer retries with bounded exponential backoff and moves events to `dead_letter` after `TASKO_WORKER_MAX_ATTEMPTS`.

> For continuous WebSocket fan-out and worker polling in production, use a persistent process. Under managed hosting this corresponds to Reserved hosting; Autoscale remains suitable for request-only use when a separate worker is deployed.

## Validation commands

Run `pnpm check`, `pnpm test`, and `pnpm build` before release. The mandatory test suite exercises tenant isolation, negative authorization scenarios, audit redaction, atomic outbox creation, tenant-scoped pub/sub and the existing session logout contract.
