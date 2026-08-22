import { describe, expect, it, vi } from "vitest";
import { sendWorkspaceInvitationEmail } from "./invitation-email-service";

describe("workspace invitation email delivery", () => {
  it("posts a single idempotent Resend email containing the one-time redeem link", async () => {
    const tko_fetch = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));
    await sendWorkspaceInvitationEmail({
      recipientEmail: "member@example.test",
      recipientRole: "member",
      tenantName: "Tasko Demo",
      deliveryToken: "one-time-token",
      expiresAt: "2026-08-22T00:00:00.000Z",
      idempotencyKey: "tasko-workspace-invitation-event-123",
    }, tko_fetch as typeof fetch);

    expect(tko_fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "tasko-workspace-invitation-event-123" }),
    }));
    const tko_request = tko_fetch.mock.calls[0]?.[1] as RequestInit;
    expect(tko_request.body).toContain("workspaceInvite=one-time-token");
    expect(tko_request.body).toContain("member@example.test");
  });
});
