# M4 Unified Workspace Architecture

## Product boundary

M4 makes Work, Chat, CRM, Docs, Forms, Inbox and Overview feel like one tenant-scoped workspace. It does not introduce external integrations, recurring polling, public webhooks, AI actions, or an autonomous scheduler. Automation v1 is therefore **deterministic and event-driven**: durable domain events enter the existing outbox worker and execute only supported local actions.

## Persistent model

Migration `0007_unified_workspace_beta.sql` adds the following tenant-scoped resources. Every table enables RLS using the existing `tasko_current_tenant_id()` policy and every durable mutation writes audit and outbox records in the same transaction.

| Resource | Purpose | Tenant safety / idempotency |
| --- | --- | --- |
| `workspace_search_documents` | Normalized full-text projection for Work, Chat, CRM and Docs. | Unique `(tenant_id, entity_type, entity_id)` allows upsert materialization. UI receives only results after exact entity authorization. |
| `workspace_inbox_items` | Personal attention queue with read/archive state. | Unique source-event and recipient key prevents repeat notifications. Services additionally enforce recipient member identity. |
| `workspace_entity_links` | Live generic links across approved workspace entity types. | Source and target existence/tenant are verified by service before write. |
| `workspace_documents` / `workspace_document_links` | Canonical JSON document content, text projection, templates and live entity references. | Owner/visibility policy is enforced by service; document link writes are tenant-scoped. |
| `workspace_forms` / `workspace_form_submissions` | Internal builder and validated submissions mapped to a WorkItem or CRM Lead. | Submission idempotency key is unique per form and mutation re-enters authorized target service. |
| `workspace_automation_rules` / `workspace_automation_executions` | Versioned local event rules plus durable action records. | Rule/event idempotency key is unique; execution depth is capped and event payloads never contain browser tenant IDs. |

Calendar/timeline needs no duplicate event table: it is a tenant-filtered projection of existing WorkItem start/due dates. Overview metrics are query-time aggregates plus Inbox and activity/search projections; this keeps M4 free of a second source of truth.

### Search visibility policy

Search always applies tenant filtering before any result construction. Chat channels/messages apply channel membership; Documents apply their owner/visibility policy; WorkItems apply their parent project visibility; all are then re-checked by the entity read path before a title, count, or snippet is returned. **Slim CRM Alpha is tenant-wide by model**: its leads, companies, contacts and deals do not yet have a resource-level private visibility or share-list attribute. CRM search is therefore authorization-gated by `crm.lead.read` and isolated across tenants, rather than pretending to implement same-tenant private CRM records. A future CRM visibility model must add a migration, centralized read policy and matching search acceptance before this distinction can change.

## Service boundaries

`packages/database/src/workspace-store.ts` is the persistence interface with matching memory and PostgreSQL implementations. `modules/workspace/src/workspace-service.ts` is the only caller used by tRPC/UI. It resolves no tenant identifiers from browser inputs: the actor comes from `tenantProcedure`, and all reads/mutations require centralized `can(actor, capability, resource)` checks.

Forms and automation do not write Work or CRM tables directly. Their target actions call `workService.createWorkItem` and `crmService.createLead`/`addActivity` using a tenant-scoped service actor. This preserves target-module validation, audit records, outbox publication, idempotency and cross-module ownership rules.

## Event materialization

The existing worker currently dispatches one consumer per `eventType`. M4 registers a small, explicit set of source event consumers for Work, Chat, CRM, document and form events. Consumers materialize search entries and relevant Inbox entries via idempotent workspace-store operations. Automation rules are evaluated in the same durable consumer path, with a maximum depth of two and an execution idempotency key derived from `(rule_id, triggering_event_id, rule_version)`.

The first rule templates deliberately support only local actions:

| Trigger | Supported condition | Action |
| --- | --- | --- |
| `crm.lead_created.v1` | lead source/status equality | create a WorkItem in an explicitly configured project |
| `work.work_item_created.v1` | project equality | create CRM activity |
| `workspace.form_submitted.v1` | form equality | create a WorkItem or CRM Lead via the declared form mapping |

No outbound HTTP/webhook action is enabled in M4, avoiding external secrets, SSRF policy and webhook verification until M6.

## Verification contract

M4 acceptance tests prove the search sequence **tenant filter → coarse metadata filter → exact authorization → snippet**; no inaccessible counts/snippets are returned. They cover private Chat, private Work projects, private Docs, and cross-tenant CRM isolation in line with the policy above. They also cover Inbox read/archive state, document relation tenant validation, Forms target mapping, automation idempotency and guest denial. PostgreSQL tests run against the Docker stack with RLS enabled.
