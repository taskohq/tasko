# Tasko M0 Runbook

## Profiles and services

The same source tree supports `DEPLOYMENT_PROFILE=single_tenant` and `DEPLOYMENT_PROFILE=saas`. In the single-tenant profile, `TASKO_SINGLE_TENANT_SLUG` is selected by the server and no browser workspace selector is treated as authority. In SaaS, a browser may request a slug but the server resolves it only if the authenticated user has an active membership.

| Concern | Environment variable | Development fallback | Production requirement |
|---|---|---|---|
| PostgreSQL | `TASKO_POSTGRES_URL` | In-memory adapter for tests/local UI | Required durable source of truth |
| Redis | `TASKO_REDIS_URL` | In-process pub/sub adapter | Required for multi-instance realtime fan-out |
| Object storage | `TASKO_STORAGE_BACKEND`, `TASKO_S3_*` | MinIO S3-compatible Docker stack | Wasabi S3-compatible bucket with server-only credentials |
| Deployment profile | `DEPLOYMENT_PROFILE` | `single_tenant` | `single_tenant` or `saas` |
| Primary workspace | `TASKO_SINGLE_TENANT_SLUG` | `tasko-demo` | Required for OSS profile |
| Worker | `TASKO_WORKER_POLL_MS`, `TASKO_WORKER_MAX_ATTEMPTS`, `TASKO_WORKER_SERVICE_SUBJECT` | 1s / 8 attempts / `service:tasko-worker` | Dedicated worker process with tenant membership |

## PostgreSQL bootstrap

Install PostgreSQL with `pgcrypto` available, provide `TASKO_POSTGRES_URL`, then run `pnpm db:platform:migrate`. The migration creates `tenants`, `users`, `tenant_members`, tenant-owned operational tables, transactional outbox, audit logs, and PostgreSQL RLS policies based on `app.tenant_id`.

Set `OWNER_OPEN_ID` and run `pnpm db:platform:seed` to create `tasko-demo`, an owner, admin, member, guest, and the worker service account. The seed is idempotent and can be safely re-run.

### Local Docker bootstrap

For normal local development, Docker Compose provides PostgreSQL 16, Redis 7, and MinIO on the isolated `tasko_internal` bridge network; database, cache, S3 API, and MinIO console are bound only to the local loopback interface. Start the stack with `sudo docker compose up -d`, wait for the long-lived services to be healthy and `minio-init` to exit with code 0, then load `.env.docker.example` into the local shell. The init job creates the private `tasko-dev` bucket once and MinIO stores only development objects in its named volume.

This managed sandbox has an iptables limitation that prevents Docker bridge networking. Only in this sandbox, start the equivalent stack with `sudo docker compose -f compose.yaml -f compose.sandbox.yaml up -d` and source `.env.docker.sandbox.example`; the override deliberately uses host networking and changes the local endpoint ports. Do not use `compose.sandbox.yaml` on a normal workstation or in production.

Run `pnpm db:platform:migrate` followed by `pnpm db:platform:seed` to bootstrap the durable workspace. The `tasko_dev_only` and MinIO development credentials are intentionally limited to the local Compose stack and must not be reused in production.

### Object storage configuration

All Tasko attachment bytes are stored through the shared S3-compatible adapter; PostgreSQL stores tenant-scoped metadata and object keys only. Set `TASKO_STORAGE_BACKEND=s3` together with `TASKO_S3_ENDPOINT`, `TASKO_S3_REGION`, `TASKO_S3_BUCKET`, `TASKO_S3_ACCESS_KEY_ID`, and `TASKO_S3_SECRET_ACCESS_KEY`. Use `TASKO_S3_FORCE_PATH_STYLE=true` for MinIO development. In the environment used by the application, configure the same fields with a private Wasabi bucket and its regional endpoint; credentials remain server-side. Downloads use five-minute signed S3 URLs and attachment services deny a tenant mismatch before a URL is signed.

If Wasabi fails its connectivity check or a storage operation cannot be verified, switch the development process to the matching MinIO Docker environment file and restart the process; the adapter contract remains unchanged. This is an explicit development fallback, not per-request automatic failover: silently switching providers after a failed write could separate database metadata from object bytes. Resolve and migrate deliberately before changing the configured durable provider for an environment.

To stop the stack while retaining local data, run `sudo docker compose down`. Use `sudo docker compose down -v` only when deliberately resetting the local PostgreSQL and Redis data volumes.

## Runtime model

The HTTP process exposes `/health` for liveness and `/ready` for readiness. Health evaluates the database, Redis and worker state; readiness returns HTTP 503 if a configured dependency is not healthy. The WebSocket gateway accepts `/api/realtime` upgrades only after verifying the session and resolving an active membership. Subscriptions are tenant-scoped and reject a mismatched tenant ID.

Run `pnpm worker` in a dedicated process to poll the PostgreSQL outbox. Each durable mutation must be created through the outbox service, which writes its audit entry and event in the same transaction. Each consumer re-resolves the tenant-scoped worker service account and uses the same capability check as HTTP before processing. The consumer retries with bounded exponential backoff and moves events to `dead_letter` after `TASKO_WORKER_MAX_ATTEMPTS`.

The Redis adapter supplies namespaced tenant pub/sub plus cache, fixed-window rate limiting, distributed locks and queue coordination. PostgreSQL outbox remains the durable event source; Redis queues are not a replacement for durable business mutations.

> For continuous WebSocket fan-out and worker polling in production, use a persistent process. Under managed hosting this corresponds to Reserved hosting; Autoscale remains suitable for request-only use when a separate worker is deployed.

## Validation commands

Run `pnpm check`, `pnpm test`, and `pnpm build` before release. The mandatory test suite exercises tenant isolation, negative authorization scenarios, audit redaction, atomic outbox creation, tenant-scoped pub/sub and the existing session logout contract. With the local stack running, source the corresponding Docker environment file and run `pnpm exec vitest run server/storage.minio.integration.test.ts` to verify MinIO upload, signed download, cleanup, and cross-tenant rejection. The separate `server/storage.wasabi.integration.test.ts` verifies Wasabi HeadBucket plus an isolated write/read/delete cycle.
