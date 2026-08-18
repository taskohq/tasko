import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import type { PlatformActor } from "../packages/contracts/src/platform";
import { getTenantAttachmentDownloadUrl, uploadTenantAttachment } from "../modules/attachments/src/attachment-storage";
import { storageGetSignedUrl, storagePut } from "./storage";
import { createTkoS3StorageClient } from "./storage.s3";

const tko_minioReady = process.env.TASKO_S3_ENDPOINT?.includes("127.0.0.1") && process.env.TASKO_S3_BUCKET === "tasko-dev";
const tko_describe = tko_minioReady ? describe : describe.skip;

tko_describe("MinIO S3-compatible storage", () => {
  it("writes a unique object and serves it through a short-lived signed URL", async () => {
    const tko_stored = await storagePut(`tests/${crypto.randomUUID()}.txt`, "tasko-minio-ok", "text/plain");
    const tko_signedUrl = await storageGetSignedUrl(tko_stored.key);

    try {
      const tko_response = await fetch(tko_signedUrl);
      expect(tko_response.status).toBe(200);
      await expect(tko_response.text()).resolves.toBe("tasko-minio-ok");
    } finally {
      const { client: tko_client, bucket: tko_bucket } = createTkoS3StorageClient({
        endpoint: process.env.TASKO_S3_ENDPOINT!,
        region: process.env.TASKO_S3_REGION!,
        bucket: process.env.TASKO_S3_BUCKET!,
        accessKeyId: process.env.TASKO_S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.TASKO_S3_SECRET_ACCESS_KEY!,
        forcePathStyle: process.env.TASKO_S3_FORCE_PATH_STYLE === "true",
      });
      try {
        await tko_client.send(new DeleteObjectCommand({ Bucket: tko_bucket, Key: tko_stored.key }));
      } finally {
        tko_client.destroy();
      }
    }
  }, 20_000);

  it("rejects cross-tenant signed-download requests before accessing object storage", async () => {
    const tko_owner: PlatformActor = {
      authSubject: "minio-owner",
      tenantId: "tko-tenant-storage-a",
      tenantSlug: "storage-a",
      memberId: "tko-member-storage-a",
      role: "owner",
      membershipStatus: "active",
      correlationId: "minio-storage-test",
    };
    const tko_attachment = await uploadTenantAttachment({
      actor: tko_owner,
      filename: "tenant-isolation.txt",
      contentType: "text/plain",
      bytes: "tenant-isolation",
    });

    try {
      await expect(getTenantAttachmentDownloadUrl({ ...tko_owner, tenantId: "tko-tenant-storage-b" }, tko_attachment)).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:tenant_mismatch");
    } finally {
      const { client: tko_client, bucket: tko_bucket } = createTkoS3StorageClient({
        endpoint: process.env.TASKO_S3_ENDPOINT!,
        region: process.env.TASKO_S3_REGION!,
        bucket: process.env.TASKO_S3_BUCKET!,
        accessKeyId: process.env.TASKO_S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.TASKO_S3_SECRET_ACCESS_KEY!,
        forcePathStyle: process.env.TASKO_S3_FORCE_PATH_STYLE === "true",
      });
      try {
        await tko_client.send(new DeleteObjectCommand({ Bucket: tko_bucket, Key: tko_attachment.objectKey }));
      } finally {
        tko_client.destroy();
      }
    }
  }, 20_000);
});
