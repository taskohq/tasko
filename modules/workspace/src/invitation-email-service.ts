import { tko_config } from "../../../packages/config/src/tasko-config";

type TkoFetch = typeof fetch;

export interface TkoWorkspaceInvitationEmailInput {
  recipientEmail: string;
  recipientRole: string;
  tenantName: string;
  deliveryToken: string;
  expiresAt: string;
  idempotencyKey: string;
}

function tko_escapeHtml(tko_value: string): string {
  return tko_value.replace(/[&<>'"]/g, tko_character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[tko_character] ?? tko_character);
}

function tko_invitationUrl(tko_token: string): string {
  if (!tko_config.appOrigin) throw new Error("TASKO_EMAIL_APP_ORIGIN_REQUIRED");
  const tko_url = new URL("/settings", tko_config.appOrigin);
  tko_url.searchParams.set("workspaceInvite", tko_token);
  return tko_url.toString();
}

export async function sendWorkspaceInvitationEmail(tko_input: TkoWorkspaceInvitationEmailInput, tko_fetch: TkoFetch = fetch): Promise<void> {
  if (!tko_config.resendApiKey || !tko_config.resendFromEmail) throw new Error("TASKO_EMAIL_PROVIDER_NOT_CONFIGURED");
  const tko_inviteUrl = tko_invitationUrl(tko_input.deliveryToken);
  const tko_workspaceName = tko_escapeHtml(tko_input.tenantName);
  const tko_expiry = new Date(tko_input.expiresAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const tko_subject = `Lời mời tham gia ${tko_input.tenantName} trên Tasko`;
  const tko_response = await tko_fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tko_config.resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": tko_input.idempotencyKey,
    },
    body: JSON.stringify({
      from: tko_config.resendFromEmail,
      to: [tko_input.recipientEmail],
      subject: tko_subject,
      html: `<p>Bạn được mời tham gia workspace <strong>${tko_workspaceName}</strong> trên Tasko với vai trò <strong>${tko_escapeHtml(tko_input.recipientRole)}</strong>.</p><p><a href="${tko_inviteUrl}">Chấp nhận lời mời</a></p><p>Liên kết hết hạn lúc ${tko_expiry} UTC và chỉ dùng được một lần.</p>`,
      text: `Bạn được mời tham gia workspace ${tko_input.tenantName} trên Tasko với vai trò ${tko_input.recipientRole}. Chấp nhận lời mời: ${tko_inviteUrl}. Liên kết hết hạn lúc ${tko_expiry} UTC và chỉ dùng được một lần.`,
    }),
  });
  if (!tko_response.ok) throw new Error(`TASKO_EMAIL_PROVIDER_DELIVERY_FAILED:${tko_response.status}`);
}
