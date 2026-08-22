import { describe, expect, it } from "vitest";

const tko_requiredResendEnvironment = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "TASKO_APP_ORIGIN"];
const tko_hasResendConfig = tko_requiredResendEnvironment.every(tko_key => Boolean(process.env[tko_key]));
const tko_describe = tko_hasResendConfig ? describe : describe.skip;

tko_describe("Resend transactional email configuration", () => {
  it("authenticates to the Resend domains endpoint with the configured server credential", async () => {
    const tko_response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });

    expect(tko_response.status).toBe(200);
    expect(await tko_response.json()).toHaveProperty("data");
  }, 20_000);
});
