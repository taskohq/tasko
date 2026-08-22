import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceInvitationEmail, sendWorkspaceInvitationEmail } from "./invitation-email-service";

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

  it("builds a branded accessible HTML template with escaped workspace content and a plain-text fallback", () => {
    const tko_email = buildWorkspaceInvitationEmail({
      recipientEmail: "member@example.test",
      recipientRole: "member",
      tenantName: "Tasko <script>alert(1)</script>",
      deliveryToken: "one-time-token",
      expiresAt: "2026-08-22T00:00:00.000Z",
      idempotencyKey: "event-123",
    });
    expect(tko_email.subject).toContain("Tasko <script>alert(1)</script>");
    expect(tko_email.html).toContain("Tasko</td>");
    expect(tko_email.html).toContain("Chấp nhận lời mời");
    expect(tko_email.html).toContain("workspaceInvite=one-time-token");
    expect(tko_email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(tko_email.html).not.toContain("<script>alert(1)</script>");
    expect(tko_email.text).toContain("workspaceInvite=one-time-token");
  });
});
