import crypto from "node:crypto";
import type { DeveloperApiScope, ExternalConnectionProvider, WebhookDelivery } from "../../../packages/contracts/src/ecosystem";
import type { OutboxRecord, PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import { getDeveloperStore, type DeveloperStore } from "../../../packages/database/src/developer-store";
import { requireCapability } from "../../permissions/src/authorization";
import { resolveWorkerServiceActor } from "../../tenancy/src/tenant-context";
import { registerOutboxObserver } from "../../worker/src/worker-service";

const tko_resource = (tko_actor: PlatformActor, tko_type: string, tko_id: string): TenantResource => ({ tenantId: tko_actor.tenantId, type: tko_type, id: tko_id, visibility: "internal" });
const tko_require = (tko_actor: PlatformActor, tko_capability: "ecosystem.api_token.manage" | "ecosystem.webhook.manage" | "ecosystem.integration.manage", tko_type: string, tko_id: string): void => requireCapability(tko_actor, tko_capability, tko_resource(tko_actor, tko_type, tko_id));
const tko_correlation = (): string => crypto.randomUUID();

function tko_validateEndpoint(tko_endpoint: string): void {
  let tko_url: URL;
  try { tko_url = new URL(tko_endpoint); } catch { throw new Error("WEBHOOK_ENDPOINT_INVALID"); }
  const tko_host = tko_url.hostname.toLowerCase();
  const tko_private = tko_host === "localhost" || tko_host.endsWith(".local") || /^127\./.test(tko_host) || /^10\./.test(tko_host) || /^192\.168\./.test(tko_host) || /^172\.(1[6-9]|2\d|3[01])\./.test(tko_host) || tko_host === "::1";
  if (tko_url.protocol !== "https:" || tko_private) throw new Error("WEBHOOK_ENDPOINT_NOT_ALLOWED");
}

export class DeveloperService {
  constructor(private readonly tko_store: DeveloperStore = getDeveloperStore()) {}

  async issueToken(tko_actor: PlatformActor, tko_input: { name: string; scopes: DeveloperApiScope[]; expiresAt?: Date | null; correlationId?: string }) { tko_require(tko_actor, "ecosystem.api_token.manage", "developer_api_token", "new"); if (!tko_input.name.trim() || !tko_input.scopes.length) throw new Error("DEVELOPER_TOKEN_INPUT_INVALID"); return this.tko_store.createToken({ actor: tko_actor, name: tko_input.name, scopes: tko_input.scopes, expiresAt: tko_input.expiresAt, correlationId: tko_input.correlationId ?? tko_correlation() }); }
  async listTokens(tko_actor: PlatformActor) { tko_require(tko_actor, "ecosystem.api_token.manage", "developer_api_token", "list"); return this.tko_store.listTokens(tko_actor.tenantId); }
  async revokeToken(tko_actor: PlatformActor, tko_tokenId: string, tko_correlationId = tko_correlation()) { tko_require(tko_actor, "ecosystem.api_token.manage", "developer_api_token", tko_tokenId); return this.tko_store.revokeToken(tko_actor, tko_tokenId, tko_correlationId); }
  async createWebhook(tko_actor: PlatformActor, tko_input: { name: string; endpointUrl: string; eventTypes: string[]; correlationId?: string }) { tko_require(tko_actor, "ecosystem.webhook.manage", "webhook_subscription", "new"); if (!tko_input.name.trim() || !tko_input.eventTypes.length) throw new Error("WEBHOOK_INPUT_INVALID"); tko_validateEndpoint(tko_input.endpointUrl); return this.tko_store.createWebhookSubscription({ actor: tko_actor, name: tko_input.name, endpointUrl: tko_input.endpointUrl, eventTypes: tko_input.eventTypes, correlationId: tko_input.correlationId ?? tko_correlation() }); }
  async listWebhooks(tko_actor: PlatformActor) { tko_require(tko_actor, "ecosystem.webhook.manage", "webhook_subscription", "list"); return this.tko_store.listWebhookSubscriptions(tko_actor.tenantId); }
  async listDeliveries(tko_actor: PlatformActor, tko_subscriptionId?: string) { tko_require(tko_actor, "ecosystem.webhook.manage", "webhook_delivery", tko_subscriptionId ?? "list"); return this.tko_store.listWebhookDeliveries(tko_actor.tenantId, tko_subscriptionId); }
  async connect(tko_actor: PlatformActor, tko_input: { provider: ExternalConnectionProvider; displayName: string; externalAccountId?: string | null; config?: Record<string, unknown>; correlationId?: string }) { tko_require(tko_actor, "ecosystem.integration.manage", "external_connection", "new"); if (!tko_input.displayName.trim()) throw new Error("EXTERNAL_CONNECTION_INPUT_INVALID"); return this.tko_store.createExternalConnection(tko_actor, { ...tko_input, correlationId: tko_input.correlationId ?? tko_correlation() }); }
  async listConnections(tko_actor: PlatformActor) { tko_require(tko_actor, "ecosystem.integration.manage", "external_connection", "list"); return this.tko_store.listExternalConnections(tko_actor.tenantId); }
  async authenticatePublicToken(tko_secret: string, tko_scope: DeveloperApiScope, tko_correlationId: string): Promise<PlatformActor> { const tko_authentication = await this.tko_store.authenticateToken(tko_secret, tko_correlationId); if (!tko_authentication || !tko_authentication.token.scopes.includes(tko_scope)) throw new Error("PUBLIC_API_SCOPE_DENIED"); return tko_authentication.actor; }
  async deliverOutboxRecord(tko_record: OutboxRecord): Promise<void> {
    if (tko_record.eventType.startsWith("ecosystem.webhook_delivery_")) return;
    const tko_actor = await resolveWorkerServiceActor({ tenantId: tko_record.tenantId, correlationId: tko_record.correlationId }); if (!tko_actor) throw new Error("TASKO_AUTHORIZATION_DENIED:worker_service_membership_missing");
    const tko_subscriptions = await this.tko_store.listWebhookSubscriptions(tko_record.tenantId);
    for (const tko_subscription of tko_subscriptions.filter(tko_item => tko_item.status === "active" && tko_item.eventTypes.includes(tko_record.eventType))) {
      const tko_delivery = await this.tko_store.createWebhookDelivery(tko_actor, { subscriptionId: tko_subscription.id, outboxEventId: tko_record.eventId, eventType: tko_record.eventType, payload: tko_record.payload, correlationId: tko_record.correlationId });
      if (!tko_delivery || tko_delivery.status === "delivered" || tko_delivery.status === "dead_letter") continue;
      await this.tko_deliver(tko_actor, tko_delivery, tko_record.correlationId);
    }
  }
  private async tko_deliver(tko_actor: PlatformActor, tko_delivery: WebhookDelivery, tko_correlationId: string): Promise<void> {
    const tko_secret = await this.tko_store.getWebhookSecret(tko_actor.tenantId, tko_delivery.subscriptionId); if (!tko_secret) return;
    const tko_body = JSON.stringify({ id: tko_delivery.outboxEventId, type: tko_delivery.eventType, tenant_id: tko_delivery.tenantId, data: tko_delivery.payload }); const tko_signature = `sha256=${crypto.createHmac("sha256", tko_secret.secret).update(tko_body).digest("hex")}`;
    try { const tko_response = await fetch(tko_secret.endpointUrl, { method: "POST", headers: { "content-type": "application/json", "x-tasko-signature": tko_signature, "x-tasko-delivery": tko_delivery.id, "x-tasko-event": tko_delivery.eventType }, body: tko_body, signal: AbortSignal.timeout(10_000) }); if (tko_response.ok) { await this.tko_store.updateWebhookDelivery(tko_actor, { deliveryId: tko_delivery.id, status: "delivered", responseStatus: tko_response.status, correlationId: tko_correlationId }); return; } throw new Error(`WEBHOOK_HTTP_${tko_response.status}`); } catch (tko_error) { const tko_message = tko_error instanceof Error ? tko_error.message : "WEBHOOK_DELIVERY_FAILED"; const tko_deadLetter = tko_delivery.attempts + 1 >= 5; await this.tko_store.updateWebhookDelivery(tko_actor, { deliveryId: tko_delivery.id, status: tko_deadLetter ? "dead_letter" : "retrying", responseError: tko_message, nextAttemptAt: tko_deadLetter ? null : new Date(Date.now() + Math.pow(2, tko_delivery.attempts) * 1_000), correlationId: tko_correlationId }); if (!tko_deadLetter) throw new Error(tko_message); }
  }
}

let tko_developerService: DeveloperService | null = null;
export function getDeveloperService(): DeveloperService { if (!tko_developerService) tko_developerService = new DeveloperService(); return tko_developerService; }
export function setDeveloperServiceForTests(tko_service: DeveloperService | null): void { tko_developerService = tko_service; }
export function registerEcosystemWebhookObserver(): void { registerOutboxObserver(tko_record => getDeveloperService().deliverOutboxRecord(tko_record)); }
