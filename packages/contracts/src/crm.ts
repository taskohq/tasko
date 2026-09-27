import type { PlatformActor, TenantResource } from "./platform";

export type CRMLeadStatus = "new" | "contacted" | "qualified" | "nurture" | "disqualified" | "converted";
export type CRMDealStageCategory = "open" | "won" | "lost";
export type CRMActivityType = "note" | "call" | "meeting" | "email_reference" | "status_change" | "file" | "linked_work_event";
export type CRMEntityType = "lead" | "company" | "contact" | "deal";

export interface CRMLead extends TenantResource {
  type: "crm_lead";
  ownerMemberId: string;
  firstName: string;
  lastName: string;
  companyName: string;
  jobTitle: string;
  email: string;
  phone: string;
  website: string;
  country: string;
  source: string;
  status: CRMLeadStatus;
  score: number | null;
  tags: string[];
  notes: string;
  nextFollowUpAt: Date | null;
  customFields: Record<string, unknown>;
  convertedAt: Date | null;
  convertedCompanyId: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  conversionKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CRMCompany extends TenantResource {
  type: "crm_company";
  name: string;
  domain: string;
  website: string;
  industry: string;
  employeeRange: string;
  country: string;
  ownerMemberId: string;
  lifecycleStatus: string;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CRMContact extends TenantResource {
  type: "crm_contact";
  companyId: string | null;
  firstName: string;
  lastName: string;
  title: string;
  emails: string[];
  phones: string[];
  ownerMemberId: string;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CRMPipeline extends TenantResource {
  type: "crm_pipeline";
  name: string;
  active: boolean;
  createdAt: Date;
}

export interface CRMPipelineStage extends TenantResource {
  type: "crm_pipeline_stage";
  pipelineId: string;
  name: string;
  sortOrder: number;
  probabilityDefault: number;
  category: CRMDealStageCategory;
}

export interface CRMDeal extends TenantResource {
  type: "crm_deal";
  companyId: string | null;
  pipelineId: string;
  stageId: string;
  name: string;
  amountCents: number | null;
  currency: string;
  probability: number;
  ownerMemberId: string;
  expectedCloseDate: Date | null;
  source: string;
  nextStep: string;
  wonAt: Date | null;
  lostAt: Date | null;
  lossReason: string;
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CRMActivity extends TenantResource {
  type: "crm_activity";
  entityType: CRMEntityType;
  entityId: string;
  activityType: CRMActivityType;
  subject: string;
  body: string;
  metadata: Record<string, unknown>;
  createdByMemberId: string;
  createdAt: Date;
}

export interface CRMEntityLink extends TenantResource {
  type: "crm_entity_link";
  sourceType: CRMEntityType;
  sourceId: string;
  targetType: "work_item" | "project" | "channel" | "message";
  targetId: string;
  relationType: "follow_up" | "delivery_project" | "delivery_channel" | "context";
  createdAt: Date;
}

export interface CRMDealHandoff extends TenantResource {
  type: "crm_deal_handoff";
  dealId: string;
  deliveryProjectId: string | null;
  deliveryChannelId: string | null;
  status: "pending" | "completed";
  createdAt: Date;
  completedAt: Date | null;
}

export interface CRMConversionResult {
  lead: CRMLead;
  company: CRMCompany;
  contact: CRMContact;
  deal: CRMDeal | null;
  activities: CRMActivity[];
  idempotent: boolean;
}

export interface CRMDealBoard {
  pipeline: CRMPipeline;
  stages: CRMPipelineStage[];
  deals: CRMDeal[];
  totalsByStage: Record<string, { amountCents: number; weightedAmountCents: number }>;
}

export interface CreateLeadInput {
  actor: PlatformActor;
  firstName: string;
  lastName: string;
  companyName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  website?: string;
  country?: string;
  source?: string;
  status?: Exclude<CRMLeadStatus, "converted">;
  score?: number | null;
  tags?: string[];
  notes?: string;
  nextFollowUpAt?: Date | null;
  customFields?: Record<string, unknown>;
  correlationId: string;
}

export interface ConvertLeadInput {
  actor: PlatformActor;
  leadId: string;
  conversionKey: string;
  companyId?: string;
  contactId?: string;
  createDeal: boolean;
  pipelineId?: string;
  stageId?: string;
  dealName?: string;
  dealAmountCents?: number | null;
  correlationId: string;
}

// M3 CRM UI extras: partial updates. `undefined` leaves a field untouched; providing a
// value (including empty string / null where allowed) replaces it. Status "converted" is
// intentionally unreachable here — conversion must go through ConvertLeadInput.
export interface UpdateLeadInput {
  leadId: string;
  ownerMemberId?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  website?: string;
  country?: string;
  source?: string;
  status?: Exclude<CRMLeadStatus, "converted">;
  score?: number | null;
  tags?: string[];
  notes?: string;
  nextFollowUpAt?: Date | null;
  customFields?: Record<string, unknown>;
  correlationId: string;
}

export interface UpdateCompanyInput {
  companyId: string;
  ownerMemberId?: string;
  name?: string;
  domain?: string;
  website?: string;
  industry?: string;
  employeeRange?: string;
  country?: string;
  lifecycleStatus?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  correlationId: string;
}

export interface UpdateContactInput {
  contactId: string;
  companyId?: string | null;
  ownerMemberId?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  emails?: string[];
  phones?: string[];
  tags?: string[];
  customFields?: Record<string, unknown>;
  correlationId: string;
}
