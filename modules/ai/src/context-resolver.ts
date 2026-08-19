import type { AIContextKind } from "../../../packages/contracts/src/ai";
import type { PlatformActor } from "../../../packages/contracts/src/platform";
import type { WorkspaceEntityType } from "../../../packages/contracts/src/workspace";
import { getChatStore } from "../../../packages/database/src/chat-store";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getWorkspaceStore } from "../../../packages/database/src/workspace-store";
import { requireCapability } from "../../permissions/src/authorization";
import { entityLinks, tko_requireEntityRead } from "../../workspace/src/workspace-service";

export interface ResolvedAIContextEntity {
  kind: AIContextKind;
  id: string;
  label: string;
  locator: string;
  summary: string;
  related: Array<{ kind: string; id: string; relationType: string }>;
  activity: string[];
}
export interface ResolvedAIContext { intent: string; entities: ResolvedAIContextEntity[]; citations: Array<{ kind: AIContextKind; id: string; label: string; locator: string }>; }

const tko_workspaceKind: Record<AIContextKind, WorkspaceEntityType> = { work_item: "work_item", project: "project", channel: "channel", message: "message", lead: "crm_lead", deal: "crm_deal", document: "document", form: "form" };
const tko_string = (tko_value: unknown, tko_max = 1_200): string => typeof tko_value === "string" ? tko_value.replace(/\b(?:api[_ -]?key|secret|password|authorization|bearer|token)\b\s*[:=]\s*[^\s,;]+/gi, "[redacted]").replace(/\s+/g, " ").trim().slice(0, tko_max) : "";
const tko_locator = (tko_kind: AIContextKind, tko_id: string) => `/${tko_kind.replaceAll("_", "-")}/${tko_id}`;

export async function resolveContext(tko_actor: PlatformActor, tko_entityRefs: Array<{ kind: AIContextKind; id: string }>, tko_intent: string): Promise<ResolvedAIContext> {
  requireCapability(tko_actor, "ai.context.read", { tenantId: tko_actor.tenantId, type: "ai_context", id: "resolve", visibility: "internal" });
  const tko_seen = new Set<string>();
  const tko_entities: ResolvedAIContextEntity[] = [];
  for (const tko_ref of tko_entityRefs.slice(0, 12)) {
    const tko_key = `${tko_ref.kind}:${tko_ref.id}`;
    if (tko_seen.has(tko_key)) continue;
    tko_seen.add(tko_key);
    await tko_requireEntityRead(tko_actor, tko_workspaceKind[tko_ref.kind], tko_ref.id);
    tko_entities.push(await tko_resolveOne(tko_actor, tko_ref));
  }
  return { intent: tko_string(tko_intent, 240), entities: tko_entities, citations: tko_entities.map(tko_entity => ({ kind: tko_entity.kind, id: tko_entity.id, label: tko_entity.label, locator: tko_entity.locator })) };
}

async function tko_resolveOne(tko_actor: PlatformActor, tko_ref: { kind: AIContextKind; id: string }): Promise<ResolvedAIContextEntity> {
  const tko_related = await tko_safeRelated(tko_actor, tko_ref);
  if (tko_ref.kind === "work_item") { const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_ref.id); if (!tko_item) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); const tko_history = await getWorkStore().listHistory(tko_actor.tenantId, tko_item.id); return { kind: tko_ref.kind, id: tko_item.id, label: tko_item.title, locator: tko_locator(tko_ref.kind, tko_item.id), summary: tko_string(`${tko_item.title}. ${tko_item.description ?? ""}`), related: tko_related, activity: tko_history.slice(-5).map(tko_row => tko_string(`${tko_row.field}: ${JSON.stringify(tko_row.before)} → ${JSON.stringify(tko_row.after)}`, 300)) }; }
  if (tko_ref.kind === "project") { const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_ref.id); if (!tko_project) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); const tko_items = await getWorkStore().listWorkItems(tko_actor.tenantId, tko_project.id); return { kind: tko_ref.kind, id: tko_project.id, label: tko_project.name, locator: tko_locator(tko_ref.kind, tko_project.id), summary: tko_string(`${tko_project.name}. ${tko_project.description ?? ""}`), related: tko_related, activity: tko_items.slice(0, 8).map(tko_item => tko_string(`${tko_item.key}: ${tko_item.title}`)) }; }
  if (tko_ref.kind === "channel") { const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_ref.id); if (!tko_channel) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); const tko_messages = await getChatStore().listMessages(tko_actor.tenantId, tko_channel.id); return { kind: tko_ref.kind, id: tko_channel.id, label: `#${tko_channel.name}`, locator: tko_locator(tko_ref.kind, tko_channel.id), summary: tko_string(tko_channel.topic ?? tko_channel.name), related: tko_related, activity: tko_messages.slice(-8).map(tko_message => tko_string(tko_message.body.text, 500)) }; }
  if (tko_ref.kind === "message") { const tko_message = await getChatStore().getMessage(tko_actor.tenantId, tko_ref.id); if (!tko_message) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); return { kind: tko_ref.kind, id: tko_message.id, label: "Message", locator: tko_locator(tko_ref.kind, tko_message.id), summary: tko_string(tko_message.body.text, 1_800), related: tko_related, activity: [] }; }
  if (tko_ref.kind === "document") { const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_ref.id); if (!tko_document) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); return { kind: tko_ref.kind, id: tko_document.id, label: tko_document.title, locator: tko_locator(tko_ref.kind, tko_document.id), summary: tko_string(tko_document.bodyText, 2_000), related: tko_related, activity: [] }; }
  if (tko_ref.kind === "form") { const tko_form = await getWorkspaceStore().getForm(tko_actor.tenantId, tko_ref.id); if (!tko_form) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); return { kind: tko_ref.kind, id: tko_form.id, label: tko_form.name, locator: tko_locator(tko_ref.kind, tko_form.id), summary: tko_string(tko_form.description), related: tko_related, activity: [] }; }
  const tko_crm = getCRMStore();
  if (tko_ref.kind === "lead") { const tko_lead = await tko_crm.getLead(tko_actor.tenantId, tko_ref.id); if (!tko_lead) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); return { kind: tko_ref.kind, id: tko_lead.id, label: tko_string(`${tko_lead.firstName} ${tko_lead.lastName}`, 180), locator: tko_locator(tko_ref.kind, tko_lead.id), summary: tko_string(JSON.stringify(tko_lead), 1_800), related: tko_related, activity: [] }; }
  const tko_deal = await tko_crm.getDeal(tko_actor.tenantId, tko_ref.id);
  if (!tko_deal) throw new Error("WORKSPACE_ENTITY_NOT_FOUND");
  return { kind: tko_ref.kind, id: tko_deal.id, label: tko_string(tko_deal.name, 180), locator: tko_locator(tko_ref.kind, tko_deal.id), summary: tko_string(JSON.stringify(tko_deal), 1_800), related: tko_related, activity: [] };
}

async function tko_safeRelated(tko_actor: PlatformActor, tko_ref: { kind: AIContextKind; id: string }): Promise<Array<{ kind: string; id: string; relationType: string }>> {
  const tko_links = await entityLinks(tko_actor, tko_workspaceKind[tko_ref.kind], tko_ref.id);
  const tko_results: Array<{ kind: string; id: string; relationType: string }> = [];
  for (const tko_link of tko_links.slice(0, 8)) {
    const tko_targetType = tko_link.sourceId === tko_ref.id ? tko_link.targetType : tko_link.sourceType;
    const tko_targetId = tko_link.sourceId === tko_ref.id ? tko_link.targetId : tko_link.sourceId;
    try { await tko_requireEntityRead(tko_actor, tko_targetType, tko_targetId); tko_results.push({ kind: tko_targetType, id: tko_targetId, relationType: tko_link.relationType }); } catch (tko_error) { if (!(tko_error instanceof Error) || !tko_error.message.startsWith("TASKO_AUTHORIZATION_DENIED")) throw tko_error; }
  }
  return tko_results;
}
