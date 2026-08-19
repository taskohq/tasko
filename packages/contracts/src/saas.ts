import type { DeploymentProfile, Tenant, TenantRole } from "./platform";

export type SaaSEntitlementStatus = "trialing" | "active" | "past_due" | "canceled";
export type TenantLifecycleStatus = "active" | "suspended";
export type BackupArchiveStatus = "requested" | "ready" | "verified" | "failed";
export type RestoreDrillStatus = "requested" | "verified" | "failed";

export interface SaaSPlan {
  key: string;
  name: string;
  description: string;
  entitlements: Record<string, boolean>;
  quotas: Record<string, number>;
  active: boolean;
}

export interface TenantEntitlement {
  tenantId: string;
  planKey: string;
  status: SaaSEntitlementStatus;
  entitlements: Record<string, boolean>;
  quotas: Record<string, number>;
  billingCustomerRef: string | null;
  billingSubscriptionRef: string | null;
  updatedAt: Date;
}

export interface TenantUsageRecord {
  id: string;
  tenantId: string;
  metric: string;
  amount: number;
  idempotencyKey: string;
  occurredAt: Date;
}

export interface TenantProvisionInput {
  name: string;
  slug: string;
  ownerAuthSubject: string;
  ownerDisplayName: string;
  planKey?: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface TenantProvisionResult {
  tenant: Tenant;
  membershipRole: Extract<TenantRole, "owner">;
  entitlement: TenantEntitlement;
  created: boolean;
}

export interface BackupManifest {
  id: string;
  tenantId: string;
  schemaVersion: string;
  checksum: string;
  objectKey: string | null;
  status: BackupArchiveStatus;
  resourceCounts: Record<string, number>;
  createdAt: Date;
}

export interface TenantExportManifest {
  format: "tasko-tenant-export-manifest/v1";
  manifest: BackupManifest;
  downloadUrl: string;
  generatedBy: string;
}

export interface RestoreDrill {
  id: string;
  tenantId: string;
  backupManifestId: string;
  status: RestoreDrillStatus;
  validation: Record<string, unknown>;
  createdAt: Date;
  completedAt: Date | null;
}

export interface SaaSQuotaDecision {
  allowed: boolean;
  metric: string;
  limit: number | null;
  current: number;
  remaining: number | null;
  reason: "allowed" | "quota_exceeded" | "feature_disabled" | "tenant_suspended";
}

export interface PlatformOperationalSnapshot {
  deploymentProfile: DeploymentProfile;
  tenants: { total: number; active: number; suspended: number };
  outbox: { pending: number; processing: number; deadLetter: number };
  generatedAt: Date;
}

export interface PlatformRecoveryProbe {
  generatedAt: Date;
  outbox: { pendingBefore: number; processedThisRun: number; pendingAfter: number; deadLetterAfter: number };
  search: { pendingIndexEventsBefore: number; pendingIndexEventsAfter: number };
  worker: { status: "standby" | "healthy" | "degraded"; processedCount: number; lastPollAt: Date | null; lastError: string | null };
}

export interface BillingIntent {
  status: "provider_not_configured" | "ready";
  kind: "checkout" | "customer_portal";
  tenantId: string;
  provider: string | null;
  url: string | null;
}
