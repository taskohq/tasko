import type { PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import { requireCapability } from "../../permissions/src/authorization";
import { storageGetSignedUrl, storagePut } from "../../../server/storage";

export interface AttachmentUploadInput {
  actor: PlatformActor;
  filename: string;
  contentType: string;
  bytes: Buffer | Uint8Array | string;
}

export interface StoredAttachment {
  id: string;
  tenantId: string;
  objectKey: string;
  filename: string;
  contentType: string;
  url: string;
}

function normalizeFilename(tko_filename: string): string {
  const tko_normalized = tko_filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!tko_normalized || tko_normalized.length > 180) throw new Error("Invalid attachment filename");
  return tko_normalized;
}

function assertAttachmentPermission(tko_actor: PlatformActor, tko_action: "attachment.upload" | "attachment.download"): void {
  const tko_resource: TenantResource = {
    tenantId: tko_actor.tenantId,
    type: "attachment",
    id: "tenant-attachment-scope",
    visibility: "internal",
  };
  requireCapability(tko_actor, tko_action, tko_resource);
}

export async function uploadTenantAttachment(tko_input: AttachmentUploadInput): Promise<StoredAttachment> {
  assertAttachmentPermission(tko_input.actor, "attachment.upload");
  const tko_attachmentId = crypto.randomUUID();
  const tko_filename = normalizeFilename(tko_input.filename);
  const tko_key = `tenants/${tko_input.actor.tenantId}/attachments/${tko_attachmentId}/${tko_filename}`;
  const tko_stored = await storagePut(tko_key, tko_input.bytes, tko_input.contentType);
  return {
    id: tko_attachmentId,
    tenantId: tko_input.actor.tenantId,
    objectKey: tko_stored.key,
    filename: tko_filename,
    contentType: tko_input.contentType,
    url: tko_stored.url,
  };
}

export async function getTenantAttachmentDownloadUrl(
  tko_actor: PlatformActor,
  tko_attachment: Pick<StoredAttachment, "tenantId" | "objectKey">,
): Promise<string> {
  if (tko_attachment.tenantId !== tko_actor.tenantId) {
    throw new Error("TASKO_AUTHORIZATION_DENIED:tenant_mismatch");
  }
  assertAttachmentPermission(tko_actor, "attachment.download");
  return storageGetSignedUrl(tko_attachment.objectKey);
}
