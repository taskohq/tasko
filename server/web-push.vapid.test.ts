import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { tko_config } from "../packages/config/src/tasko-config";

describe("Tasko Web Push VAPID configuration", () => {
  it("signs standard Chrome Web Push headers with the configured VAPID key pair", () => {
    expect(tko_config.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(tko_config.vapidPrivateKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const tko_headers = webpush.getVapidHeaders(
      "https://fcm.googleapis.com/fcm/send/tasko-vapid-validation",
      "mailto:notifications@tasko.local",
      tko_config.vapidPublicKey,
      tko_config.vapidPrivateKey,
      "aes128gcm",
    );
    expect(tko_headers.Authorization).toContain("vapid");
    expect(tko_headers.Authorization).toContain(tko_config.vapidPublicKey);
    expect(tko_headers).toHaveProperty("Authorization");
  });
});
