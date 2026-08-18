# ADR 0001 — One tenant-aware modular monolith

## Status

Accepted for M0.

## Decision

Tasko uses one repository, one tenant-aware PostgreSQL schema and one modular-monolith domain layer for both `single_tenant` and `saas` deployment profiles. The browser can offer a workspace slug only as a candidate; server-side active membership resolution always selects the tenant context. Every durable platform mutation is recorded with its audit row and outbox event in one database transaction.

## Consequences

Redis is an adapter for ephemeral coordination rather than a source of truth. Future Work, Chat, CRM, Docs, Search, Automation and AI modules must use the `can(actor, action, resource)` authorization primitive and emit durable side effects through the transactional outbox.
