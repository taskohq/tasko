import { DeleteObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { storageGetSignedUrl, storagePut } from "./storage";

const tko_requiredS3Environment = [
  "TASKO_S3_ENDPOINT",
  "TASKO_S3_REGION",
  "TASKO_S3_BUCKET",
  "TASKO_S3_ACCESS_KEY_ID",
  "TASKO_S3_SECRET_ACCESS_KEY",
];

const tko_hasWasabiConfig = tko_requiredS3Environment.every(tko_key => Boolean(process.env[tko_key]));
const tko_describe = tko_hasWasabiConfig ? describe : describe.skip;

tko_describe("Wasabi S3 configuration", () => {
  it("authenticates to the configured Tasko bucket with HeadBucket", async () => {
    const tko_client = new S3Client({
      endpoint: process.env.TASKO_S3_ENDPOINT,
      region: process.env.TASKO_S3_REGION,
      credentials: {
        accessKeyId: process.env.TASKO_S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.TASKO_S3_SECRET_ACCESS_KEY!,
      },
    });

    await expect(tko_client.send(new HeadBucketCommand({ Bucket: process.env.TASKO_S3_BUCKET }))).resolves.toBeDefined();
    tko_client.destroy();
  }, 20_000);

  it("writes, downloads and removes an isolated object through the shared storage adapter", async () => {
    const tko_stored = await storagePut(`tests/${crypto.randomUUID()}.txt`, "tasko-wasabi-ok", "text/plain");
    try {
      const tko_response = await fetch(await storageGetSignedUrl(tko_stored.key));
      expect(tko_response.status).toBe(200);
      await expect(tko_response.text()).resolves.toBe("tasko-wasabi-ok");
    } finally {
      const tko_client = new S3Client({
        endpoint: process.env.TASKO_S3_ENDPOINT,
        region: process.env.TASKO_S3_REGION,
        credentials: {
          accessKeyId: process.env.TASKO_S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.TASKO_S3_SECRET_ACCESS_KEY!,
        },
      });
      try {
        await tko_client.send(new DeleteObjectCommand({ Bucket: process.env.TASKO_S3_BUCKET, Key: tko_stored.key }));
      } finally {
        tko_client.destroy();
      }
    }
  }, 20_000);
});
