import type { PlatformActor } from "../../../packages/contracts/src/platform";
import type { WorkspacePublicFormDefinition } from "../../../packages/contracts/src/workspace";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getWorkspaceStore } from "../../../packages/database/src/workspace-store";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { isFeatureEnabled } from "../../platform/src/feature-flags";
import { getSaaSService } from "../../saas/src/saas-service";
import * as crmService from "../../crm/src/crm-service";
import * as workService from "../../work/src/work-service";

/** Public form intake (spec 10 §5): pure service logic with no HTTP or framework imports, so the
 * express wrapper in server/platform/public-forms.ts stays a thin registration shell. Every path
 * here is unauthenticated — the slug IS the credential — so ordering is deliberate: cheap spam
 * gates (honeypot, rate limit) run before any tenant lookup. */

const tko_publicFormRateLimit = 10;
const tko_publicFormRateWindowMs = 60_000;

function tko_text(tko_value: unknown): string { return typeof tko_value === "string" ? tko_value.trim() : ""; }

export async function publicFormDefinition(tko_slug: string): Promise<WorkspacePublicFormDefinition> {
  const tko_form = await getWorkspaceStore().getPublicFormBySlug(tko_slug);
  if (!tko_form) throw new Error("WORKSPACE_FORM_NOT_FOUND");
  return getWorkspaceStore().getFormDefinitionForPublic(tko_form);
}

async function tko_actorForPublicSubmission(tko_tenantId: string, tko_ownerMemberId: string): Promise<PlatformActor> {
  const tko_members = await getPlatformStore().listTenantMembers(tko_tenantId);
  const tko_membership = tko_members.find(tko_member => tko_member.id === tko_ownerMemberId && tko_member.status === "active")
    ?? tko_members.find(tko_member => tko_member.role === "owner" && tko_member.status === "active");
  if (!tko_membership) throw new Error("WORKSPACE_FORM_SUBMISSION_ACTOR_MISSING");
  return { authSubject: tko_membership.authSubject, tenantId: tko_membership.tenant.id, tenantSlug: tko_membership.tenant.slug, memberId: tko_membership.id, role: tko_membership.role, membershipStatus: tko_membership.status, correlationId: `tko_public_form:${tko_membership.tenant.id}` };
}

export interface PublicFormSubmissionResult {
  formId: string;
  submissionId: string;
  targetEntityType: "work_item" | "crm_lead";
  targetEntityId: string;
  duplicate: boolean;
}

export async function submitPublicForm(tko_input: { slug: string; values: Record<string, unknown>; honeypot?: unknown; clientIp: string; idempotencyKey: string }): Promise<PublicFormSubmissionResult> {
  // Honeypot: hidden field that humans never fill. Filled => bot. Rejected before any lookup.
  if (tko_text(tko_input.honeypot)) throw new Error("WORKSPACE_FORM_HONEYPOT_REJECTED");
  const tko_ip = tko_text(tko_input.clientIp) || "unknown";
  const tko_rate = await getRedisAdapter().takeRateLimit(`public_form:${tko_input.slug}:${tko_ip}`, tko_publicFormRateLimit, tko_publicFormRateWindowMs);
  if (!tko_rate.allowed) throw new Error("WORKSPACE_FORM_RATE_LIMITED");
  const tko_form = await getWorkspaceStore().getPublicFormBySlug(tko_input.slug);
  if (!tko_form) throw new Error("WORKSPACE_FORM_NOT_FOUND");
  // Feature gate (spec 03 P0): the publicForms flag defaults to ENABLED when unset so existing
  // deployments keep accepting submissions; an explicit tenant override or env default of 0 disables intake.
  if (!(await isFeatureEnabled(tko_form.tenantId, "publicForms"))) throw new Error("WORKSPACE_FORM_SUBMISSIONS_DISABLED");
  for (const tko_field of tko_form.fields) if (tko_field.required && !tko_text(tko_input.values[tko_field.id])) throw new Error(`WORKSPACE_FORM_REQUIRED_FIELD:${tko_field.id}`);
  const tko_existing = await getWorkspaceStore().getFormSubmission(tko_form.tenantId, tko_form.id, tko_input.idempotencyKey);
  if (tko_existing) return { formId: tko_form.id, submissionId: tko_existing.id, targetEntityType: tko_existing.targetEntityType as "work_item" | "crm_lead", targetEntityId: tko_existing.targetEntityId, duplicate: true };
  const tko_actor = await tko_actorForPublicSubmission(tko_form.tenantId, tko_form.ownerMemberId);
  const tko_correlationId = `tko_public_form:${tko_form.id}:${tko_input.idempotencyKey}`;
  await getSaaSService().enforceFeatureUsage(tko_actor, { feature: "forms", metric: "form_submissions", amount: 1, idempotencyKey: `form:${tko_form.id}:${tko_input.idempotencyKey}`, correlationId: tko_input.idempotencyKey });
  const tko_source = `public_form:${tko_form.id}`;
  if (tko_form.targetType === "work_item") {
    const tko_projectId = tko_text(tko_form.targetConfig.projectId);
    if (!tko_projectId) throw new Error("WORKSPACE_FORM_WORK_PROJECT_REQUIRED");
    const tko_project = await getWorkStore().getProject(tko_form.tenantId, tko_projectId);
    if (!tko_project) throw new Error("WORKSPACE_FORM_WORK_PROJECT_NOT_FOUND");
    const tko_item = await workService.createWorkItem({ actor: tko_actor, projectId: tko_project.id, title: tko_text(tko_input.values.title) || tko_form.name, description: tko_text(tko_input.values.description) || undefined, correlationId: tko_correlationId });
    const tko_submission = await getWorkspaceStore().recordFormSubmission(tko_actor, { formId: tko_form.id, values: { ...tko_input.values, _source: tko_source }, targetEntityType: "work_item", targetEntityId: tko_item.id, idempotencyKey: tko_input.idempotencyKey, correlationId: tko_input.idempotencyKey });
    return { formId: tko_form.id, submissionId: tko_submission.id, targetEntityType: "work_item", targetEntityId: tko_item.id, duplicate: false };
  }
  const tko_lead = await crmService.createLead({ actor: tko_actor, firstName: tko_text(tko_input.values.firstName) || "Form", lastName: tko_text(tko_input.values.lastName) || "Submission", companyName: tko_text(tko_input.values.companyName) || undefined, email: tko_text(tko_input.values.email) || undefined, notes: tko_text(tko_input.values.notes) || undefined, source: tko_source, correlationId: tko_correlationId });
  const tko_submission = await getWorkspaceStore().recordFormSubmission(tko_actor, { formId: tko_form.id, values: { ...tko_input.values, _source: tko_source }, targetEntityType: "crm_lead", targetEntityId: tko_lead.id, idempotencyKey: tko_input.idempotencyKey, correlationId: tko_input.idempotencyKey });
  return { formId: tko_form.id, submissionId: tko_submission.id, targetEntityType: "crm_lead", targetEntityId: tko_lead.id, duplicate: false };
}
