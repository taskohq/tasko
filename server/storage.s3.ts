import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface TkoS3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function tko_requireS3Config(tko_config: TkoS3StorageConfig): TkoS3StorageConfig {
  const tko_missing = [
    ["TASKO_S3_ENDPOINT", tko_config.endpoint],
    ["TASKO_S3_REGION", tko_config.region],
    ["TASKO_S3_BUCKET", tko_config.bucket],
    ["TASKO_S3_ACCESS_KEY_ID", tko_config.accessKeyId],
    ["TASKO_S3_SECRET_ACCESS_KEY", tko_config.secretAccessKey],
  ].filter(([, tko_value]) => !tko_value).map(([tko_name]) => tko_name);
  if (tko_missing.length) throw new Error(`S3 storage config missing: ${tko_missing.join(", ")}`);
  return tko_config;
}

export function createTkoS3StorageClient(tko_config: TkoS3StorageConfig): { client: S3Client; bucket: string } {
  const tko_validConfig = tko_requireS3Config(tko_config);
  return {
    client: new S3Client({
      endpoint: tko_validConfig.endpoint,
      region: tko_validConfig.region,
      forcePathStyle: tko_validConfig.forcePathStyle,
      credentials: {
        accessKeyId: tko_validConfig.accessKeyId,
        secretAccessKey: tko_validConfig.secretAccessKey,
      },
    }),
    bucket: tko_validConfig.bucket,
  };
}

export async function tkoPutObject(
  tko_config: TkoS3StorageConfig,
  tko_key: string,
  tko_data: Buffer | Uint8Array | string,
  tko_contentType: string,
): Promise<void> {
  const { client: tko_client, bucket: tko_bucket } = createTkoS3StorageClient(tko_config);
  try {
    await tko_client.send(new PutObjectCommand({ Bucket: tko_bucket, Key: tko_key, Body: tko_data, ContentType: tko_contentType }));
  } finally {
    tko_client.destroy();
  }
}

export async function tkoGetSignedObjectUrl(tko_config: TkoS3StorageConfig, tko_key: string): Promise<string> {
  const { client: tko_client, bucket: tko_bucket } = createTkoS3StorageClient(tko_config);
  try {
    return await getSignedUrl(tko_client, new GetObjectCommand({ Bucket: tko_bucket, Key: tko_key }), { expiresIn: 300 });
  } finally {
    tko_client.destroy();
  }
}
