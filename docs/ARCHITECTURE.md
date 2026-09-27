# Tasko Architecture

Tasko is a **Work Operations Platform**: Conversations → Work → Customers → Automation → AI.
This document summarizes the implemented system for engineers and AI agents working in this
repository. Authoritative product specs live outside the repo (`tasko_product_spec_v4_manus_ready/`).

## 1. Architecture style

Modular monolith, not microservices. One deployment unit, one transaction boundary across linked
domains, and a durable event (outbox) stream that preserves the future extraction path. Domain
modules may not update another module's tables — they call the owning module's service or emit an
event (e.g. CRM "won deal" handoff calls the Work service).

## 2. Repository layout

```text
tasko/
  apps/            # deployment-shaped entrypoints
    web/           # static web build artifacts
    api/           # api deployment shape
    worker/        # outbox worker entrypoint (apps/worker/src/index.ts)
  client/          # React + Vite SPA (pages, components, lib state helpers)
  server/          # HTTP/WS layer
    _core/         # framework core: trpc context, env, oauth sdk, cookies, llm client
    ai/            # MCP server (JSON-RPC over HTTP at /api/mcp)
    platform/      # websocket gateway, health, public forms, reminder push
    routers.ts     # appRouter: all tRPC procedures, grouped by module section
    routers.*-extras.ts  # additive procedure groups the orchestrator spreads into routers.ts
  modules/         # domain modules (the heart of the system)
    ai/ audit/ auth/ chat/ crm/ ecosystem/ events/ permissions/ platform/ saas/ tenancy/ work/ worker/ workspace/ attachments/
  packages/        # shared libraries
    contracts/     # pure TypeScript domain types (TenantResource, inputs, events)
    database/      # store twins: Memory*Store and Postgres*Store per domain
    config/        # env-parsed tko_config
    redis/         # redis adapter (cache, pub/sub, rate limit) + in-memory twin for tests
    observability/ # logging/metrics helpers
  shared/          # isomorphic constants (@shared/const)
  drizzle/         # SQL migration files (numbered, never edited after apply)
  scripts/         # migrate-postgres.mjs, seed-platform.mjs
  docs/            # design + verification notes (this file)
```

Rules:
- modules depend on packages/contracts and packages/database, never on the HTTP layer;
- stores have memory + postgres twins that must behave identically (tests run both, postgres gated by env);
- no runtime schema sync — migrations are applied explicitly with `npm run db:platform:migrate`.

## 3. Request flow

```
React SPA (client/src, tRPC react-query, superjson)
  → tRPC v11 router (server/routers.ts + routers.*-extras.ts)
    → module service (modules/*/src/*-service.ts, zod-validated inputs)
      → authorization: requireCapability(actor, capability, tenantResource)
      → store (packages/database/src/*-store.ts, tenant-scoped)
        → platform store writeDurableMutation: business row + audit_logs row + outbox row (same transaction)
      → worker (apps/worker) polls outbox: reserveOutbox → process → publishTenant (Redis pub/sub)
        → websocket gateway (server/platform/websocket-gateway.ts) fans out to subscribed clients
```

- Every durable mutation writes the business change, an `audit_logs` row and an `outbox` row in one
  transaction. The audit trail is append-only; the outbox is the event backbone.
- Correlation IDs flow from the HTTP request (`ctx.correlationId`) through services, stores, audit
  rows and outbox events.

## 4. Auth and session model

- Email/password + OAuth sign-in produce a session token (HTTP-only cookie, `COOKIE_NAME`).
- Sessions are server-side rows (`packages/database/src/session-store.ts`) hashed by token hash,
  with `revokedAt` support: `revoke(tokenHash)` and `revokeAllForSubject` power logout and
  account-level revocation. Every request validates the session row, not just the JWT signature.
- Tenant context: each request resolves `PlatformActor`
  (`authSubject`, `tenantId`, `tenantSlug`, `memberId`, `role`, `membershipStatus`).
- Authorization is centralized in `modules/permissions/src/authorization.ts`:
  `can(actor, capability, resource)` / `requireCapability(...)` against a role→capability matrix
  (owner, admin, member, guest, service_account) with tenant scoping, private-resource and
  guest-scope rules. Capability names are strings like `work.item.create`, `crm.deal.manage`,
  `ai.action.propose`.

## 5. Realtime protocol

- Transport: websocket gateway at `/api/socket` (server/platform/websocket-gateway.ts).
- On connect the client authenticates with the session token; the server subscribes the connection
  to the tenant Redis channel (`subscribeTenant`) plus tenant-wide presence.
- Client subscribes to scopes with `{ type: "subscribe" }` messages:
  `projectId` (work board updates) and `channelId` (chat messages, typing, read cursors). The
  server re-checks `work.project.read` / `chat.channel.read` before acknowledging `{ type: "subscribed" }`.
- Messages are fanned out from the worker via Redis pub/sub per tenant channel.

## 6. Event model and naming

- Outbox topics: lowercase dotted domain names — `ai`, `chat.message`, `chat.channel`,
  `crm.deal`, `tenant.lifecycle`, `tenant.membership`, `workspace.invitation`,
  `security.authentication`, `saas.usage`, `data.export`, `platform.feature_flags`, ...
- Event types: `<domain>_<past_tense_action>.v1` — e.g. `chat.message_created.v1`,
  `crm.deal_stage_changed.v1`, `ai.run_started.v1`, `ai.proposal_created.v1`,
  `ai.proposal_lifecycle.v1`, `ai.tool_executed.v1`.
- Audit actions (audit_logs.action): dotted, verb-phrased — `ai.tool.executed`, `ai.tool.denied`,
  `ai.tool.failed`, `ai.proposal.confirmed`, `ai.proposal.expired`, `tenant.membership.role_changed`,
  `auth.login`. Metadata is redacted by the audit service (secret-looking keys → `[REDACTED]`).

## 7. AI module (M7)

- `modules/ai/src/context-resolver.ts`: `resolveContext(actor, entityRefs, intent)` returns only
  entities the actor can read (permission checks stay outside prompts), with citations persisted as
  `ai_context_references`.
- `modules/ai/src/ai-service.ts`: read/draft runs persisted in `ai_runs` (model, token usage,
  redacted prompt); write actions run exclusively through the proposal flow
  `ai.propose → ai.confirm → ai.execute` (15-minute expiry, idempotency key, status machine
  `proposed → confirmed → executed | failed | expired | rejected`, persisted in `ai_tool_proposals`).
- `modules/ai/src/tool-registry.ts`: the tool registry (spec 15 §4) — `context.read`,
  `work_item.draft`, `document.draft` (read/draft), `work_item.create`, `chat.message.send`,
  `work.transition_status`, `crm.update_deal_stage` (write, proposal-required). Each definition
  carries risk level, required capability, confirmation policy, idempotency flag and pragmatic
  `inputFields` hints. Every execution is capability-checked and durably audited
  (`ai.tool.executed` / `ai.tool.denied` / `ai.tool.failed`) via the audit service.
- `server/ai/mcp-server.ts`: MCP server (JSON-RPC over HTTP at `/api/mcp`) — `Bearer tko_`
  developer token with the `mcp` scope, capability check, Redis rate limit; tool calls flow through
  the same registry, so write tools automatically stage proposals instead of executing.
- AI page (`client/src/pages/AI.tsx`): ask/draft with citations, context picker, propose section
  (stage → preview payload → confirm → run), proposal list, run history.

## 8. Testing layers (spec 22 §8)

- Unit/domain tests next to modules (`modules/**/*.test.ts`) run everywhere, offline.
- Integration tests use memory stores; postgres twins run under the same suites gated by
  `TASKO_POSTGRES_URL` + `TASKO_RUN_POSTGRES_INTEGRATION_TESTS=1` (self-skipping otherwise).
- Storage suites (MinIO/Wasabi) and the Resend suite self-skip without their env contract;
  `server/postgres.connection.test.ts` requires a live `TASKO_POSTGRES_URL`.
- Required negative tests: authorization matrix and tenant isolation (spec 25 test gates).
- CI: `.github/workflows/ci.yml` — `npm run check` (full tsc) + `npx vitest run` (excluding the
  live-postgres connection suite; everything else is green offline).

## 9. Mandatory naming convention

Every ordinary Tasko-owned variable is prefixed `tko_`:

```ts
const tko_userId = user.id;          // ordinary local
const { userId } = external;         // destructured external key
const tko_userId = userId;           // → mapped, then used
```

Exceptions (keep original names): function/class/type/interface/enum names, filenames, external
contract keys, DB columns, framework-required identifiers, and destructured external keys (map them
to a `tko_` variable before use).

## 10. Adding a feature (checklist)

1. Read the module spec before coding.
2. Types in `packages/contracts/src/<domain>.ts`; additive changes only.
3. Store methods in both memory + postgres twins.
4. Service logic + `requireCapability` in the module service; durable audit through
   `modules/audit` (`recordAuditedEvent`) for cross-cutting actions.
5. tRPC procedures in `server/routers.ts` or, additively, `server/routers.<domain>-extras.ts`.
6. Tests including negative permission cases; run `npx vitest run modules/<domain>`.
7. Update docs when contracts or event names change.
