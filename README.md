# Tasko

Tasko is a **Work Operations Platform**: Conversations → Work → Customers → Automation → AI.
A modular-monolith TypeScript codebase: tRPC v11 + zod API, React SPA, PostgreSQL with a durable
outbox/event worker, Redis pub/sub + rate limiting, and S3-compatible file storage.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture summary (layout,
request flow, auth/session model, realtime protocol, event naming, testing layers, and the
mandatory `tko_` naming rule).

## Requirements

- Node.js 20+
- npm
- Docker (for the dev infrastructure via `compose.yaml`)

## Quick start

```bash
# 1. Install dependencies (no lockfile is committed)
npm install --no-audit --no-fund

# 2. Start PostgreSQL, Redis and MinIO (bound to 127.0.0.1)
docker compose -f compose.yaml up -d

# 3. Apply the PostgreSQL migrations, then seed the platform/demo workspace
npm run db:platform:migrate
npm run db:platform:seed

# 4. Run the API + web dev server (terminal 1)
npm run dev

# 5. Run the outbox worker (terminal 2) — drains durable events into Redis pub/sub
npm run worker
```

The dev server boots on `http://localhost:3000` (see `TASKO_APP_ORIGIN`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API + web dev server (`tsx watch server/_core/index.ts`) |
| `npm run worker` | Outbox worker: reserves durable events, processes them, publishes to Redis |
| `npm run db:platform:migrate` | Applies numbered SQL migrations from `drizzle/` (`TASKO_POSTGRES_URL` required) |
| `npm run db:platform:seed` | Seeds the platform/demo workspace |
| `npm run check` | Full repository typecheck (`tsc --noEmit`) |
| `npm run test` | `vitest run` over all suites |
| `npm run build` / `npm run start` | Production build (vite + esbuild) and start |

## Environment variables

Infrastructure endpoints (local values match `compose.yaml`):

| Variable | Purpose | Local dev value |
| --- | --- | --- |
| `TASKO_POSTGRES_URL` | PostgreSQL connection string (empty ⇒ in-memory store twins) | `postgres://tasko:tasko_dev_only@127.0.0.1:54329/tasko` |
| `TASKO_REDIS_URL` | Redis connection string (empty ⇒ in-memory adapter) | `redis://127.0.0.1:63799` |
| `TASKO_APP_ORIGIN` | Public app origin (links, cookies, invitations) | `http://localhost:3000` |
| `JWT_SECRET` | Session token secret | any long random string |
| `OAUTH_SERVER_URL` | OAuth provider base URL | provided by your OAuth deployment |
| `VITE_APP_ID` | Application id used by the auth SDK | your app id |

Transactional email (Resend) — optional; unset both to disable email delivery:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `RESEND_FROM_EMAIL` | Verified sender address |

File storage (S3-compatible; MinIO in local dev) — optional; set to enable durable file bytes:

| Variable | Purpose | Local dev value |
| --- | --- | --- |
| `TASKO_S3_ENDPOINT` | S3 endpoint (presence enables S3 storage) | `http://127.0.0.1:59000` |
| `TASKO_S3_REGION` | S3 region | `us-east-1` |
| `TASKO_S3_BUCKET` | Bucket (created by the compose `minio-init` job) | `tasko-dev` |
| `TASKO_S3_ACCESS_KEY_ID` | Access key | `tasko_minio_dev` |
| `TASKO_S3_SECRET_ACCESS_KEY` | Secret key | `tasko_minio_dev_only_change_me` |
| `TASKO_S3_FORCE_PATH_STYLE` | Path-style addressing for MinIO | `true` |

Worker tuning (optional): `TASKO_WORKER_POLL_MS`, `TASKO_WORKER_MAX_ATTEMPTS`,
`TASKO_WORKER_SERVICE_SUBJECT`.

## Testing

```bash
npx vitest run              # everything (offline suites)
npx vitest run modules/ai   # a single module
```

- Unit/domain suites run fully offline on the in-memory store twins.
- PostgreSQL suites self-skip unless `TASKO_POSTGRES_URL` **and**
  `TASKO_RUN_POSTGRES_INTEGRATION_TESTS=1` are set.
- Storage (MinIO/Wasabi) and Resend suites self-skip without their env contract.
- `server/postgres.connection.test.ts` requires a live `TASKO_POSTGRES_URL`.

CI (`.github/workflows/ci.yml`) runs `npm run check` and `npx vitest run` on Node 20 with dummy
auth/email env; every env-gated suite stays skipped, so CI is green without real services.

## Conventions

- **Every ordinary Tasko-owned variable is prefixed `tko_`.** Exceptions: function/class/type/
  interface/enum names, filenames, external contract keys, DB columns, framework-required
  identifiers, destructured external keys (map them: `const { userId } = x; const tko_userId = userId;`).
- Authorization always goes through `can()` / `requireCapability()`
  (`modules/permissions/src/authorization.ts`) — no ad-hoc role checks in pages or routers.
- Cross-cutting actions write durable audit records via `modules/audit` (`recordAuditedEvent`).
- Never log raw secrets or full sensitive prompts; reuse the redaction helpers.
