import type { PlatformActor, TenantResource } from "./platform";

export type ImportSource = "jira" | "clickup" | "slack" | "crm_csv";
export type ImportJobStatus = "draft" | "parsed" | "validated" | "ready" | "executing" | "completed" | "failed" | "cancelled";
export type ImportBatchStatus = "queued" | "running" | "completed" | "failed";
export type ImportRecordStatus = "staged" | "valid" | "warning" | "error" | "imported" | "skipped";
export type ImportDuplicateStrategy = "skip" | "update" | "create_duplicate";
export type ImportTargetKind = "space" | "project" | "saved_view" | "work_item" | "channel" | "message" | "lead" | "company" | "contact" | "deal";

export interface ImportJob extends TenantResource {
  type: "import_job";
  source: ImportSource;
  status: ImportJobStatus;
  name: string;
  sourceObjectKey: string | null;
  createdByMemberId: string;
  idempotencyKey: string;
  totalRecords: number;
  importedRecords: number;
  warningCount: number;
  errorCount: number;
  cursor: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface ImportStagingRecord extends TenantResource {
  type: "import_staging_record";
  importJobId: string;
  sourceRecordId: string;
  sourceType: string;
  status: ImportRecordStatus;
  payload: Record<string, unknown>;
  validation: Record<string, unknown>;
  targetKind: ImportTargetKind | null;
  targetEntityId: string | null;
  sourceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportFieldMapping {
  sourceField: string;
  targetField: string;
  transform: "identity" | "lowercase" | "email" | "date" | "split_name";
  required: boolean;
}

export interface ImportMapping extends TenantResource {
  type: "import_mapping";
  importJobId: string;
  sourceType: string;
  targetKind: ImportTargetKind;
  duplicateStrategy: ImportDuplicateStrategy;
  ownerMemberId: string | null;
  fields: ImportFieldMapping[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportBatch extends TenantResource {
  type: "import_batch";
  importJobId: string;
  sequence: number;
  status: ImportBatchStatus;
  idempotencyKey: string;
  recordIds: string[];
  processedCount: number;
  warningCount: number;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ImportSourceMapping extends TenantResource {
  type: "import_source_mapping";
  importJobId: string;
  sourceRecordId: string;
  targetKind: ImportTargetKind;
  targetEntityId: string;
  createdAt: Date;
}

export type DeveloperApiScope =
  | "work:read"
  | "work:write"
  | "chat:read"
  | "chat:write"
  | "crm:read"
  | "crm:write"
  | "imports:read"
  | "imports:write"
  | "webhooks:manage"
  | "integrations:manage"
  | "mcp:connect";

export interface DeveloperApiToken extends TenantResource {
  type: "developer_api_token";
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: DeveloperApiScope[];
  createdByMemberId: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type WebhookSubscriptionStatus = "active" | "disabled";
export type WebhookDeliveryStatus = "pending" | "delivered" | "retrying" | "dead_letter";

export interface WebhookSubscription extends TenantResource {
  type: "webhook_subscription";
  name: string;
  endpointUrl: string;
  signingSecretHash: string;
  eventTypes: string[];
  status: WebhookSubscriptionStatus;
  consecutiveFailures: number;
  createdByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery extends TenantResource {
  type: "webhook_delivery";
  subscriptionId: string;
  outboxEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  responseError: string | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export type ExternalConnectionProvider = "github" | "gitlab" | "jira" | "clickup" | "slack";
export type ExternalConnectionStatus = "pending" | "connected" | "disabled" | "error";

export interface ExternalConnection extends TenantResource {
  type: "external_connection";
  provider: ExternalConnectionProvider;
  status: ExternalConnectionStatus;
  displayName: string;
  externalAccountId: string | null;
  encryptedSecretRef: string | null;
  config: Record<string, unknown>;
  createdByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateImportJobInput {
  actor: PlatformActor;
  source: ImportSource;
  name: string;
  sourceObjectKey?: string | null;
  idempotencyKey: string;
  correlationId: string;
}

export interface CreateDeveloperTokenInput {
  actor: PlatformActor;
  name: string;
  scopes: DeveloperApiScope[];
  expiresAt?: Date | null;
  correlationId: string;
}

export interface IssuedDeveloperToken {
  token: DeveloperApiToken;
  secret: string;
}

export interface CreateWebhookSubscriptionInput {
  actor: PlatformActor;
  name: string;
  endpointUrl: string;
  eventTypes: string[];
  correlationId: string;
}

export interface IssuedWebhookSubscription {
  subscription: WebhookSubscription;
  signingSecret: string;
}

export interface PublicApiErrorEnvelope {
  error: { code: string; message: string; request_id: string };
}

export interface CursorPage<T> {
  data: T[];
  page: { next_cursor: string | null };
}

/** Module CSV export (spec 19 §7): tenant-scoped tabular exports audited as data.exported.v1. */
export type CsvExportEntityType =
  | "work_items"
  | "time_logs"
  | "crm_leads"
  | "crm_companies"
  | "crm_contacts"
  | "crm_deals";

export interface CsvExportFilters {
  projectId?: string | null;
  pipelineId?: string | null;
}

export interface CsvExportInput {
  entityType: CsvExportEntityType;
  filters?: CsvExportFilters;
}

export interface CsvExportResult {
  filename: string;
  csv: string;
  rowCount: number;
  entityType: CsvExportEntityType;
}
