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

export function buildWorkspaceInvitationEmail(tko_input: TkoWorkspaceInvitationEmailInput) {
  const tko_inviteUrl = tko_invitationUrl(tko_input.deliveryToken);
  const tko_workspaceName = tko_escapeHtml(tko_input.tenantName);
  const tko_role = tko_escapeHtml(tko_input.recipientRole);
  const tko_safeInviteUrl = tko_escapeHtml(tko_inviteUrl);
  const tko_expiry = new Date(tko_input.expiresAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const tko_subject = `Bạn được mời vào ${tko_input.tenantName} trên Tasko`;
  const tko_text = `Bạn được mời tham gia workspace ${tko_input.tenantName} trên Tasko với vai trò ${tko_input.recipientRole}. Chấp nhận lời mời: ${tko_inviteUrl}. Liên kết hết hạn lúc ${tko_expiry} UTC và chỉ dùng được một lần.`;
  const tko_html = `<!doctype html>
<html lang="vi">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f5f7fb;color:#182230;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Bạn được mời cộng tác trong ${tko_workspaceName} trên Tasko.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f7fb;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;overflow:hidden;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;">
          <tr><td style="padding:28px 36px 24px;background:#171737;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="width:32px;height:32px;border-radius:7px;background:#766df0;color:#ffffff;font-size:18px;font-weight:800;line-height:32px;text-align:center;">T</td>
              <td style="padding-left:10px;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.4px;">Tasko</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:36px;">
            <p style="margin:0 0 12px;color:#766df0;font-size:12px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">Workspace invitation</p>
            <h1 style="margin:0;color:#182230;font-size:28px;line-height:1.22;letter-spacing:-0.7px;">Cùng đưa công việc tiến về phía trước.</h1>
            <p style="margin:20px 0 0;color:#475467;font-size:16px;line-height:1.65;">Bạn được mời tham gia workspace <strong style="color:#182230;">${tko_workspaceName}</strong> trên Tasko với vai trò <strong style="color:#182230;text-transform:capitalize;">${tko_role}</strong>.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;"><tr><td style="border-radius:7px;background:#5b51e8;">
              <a href="${tko_safeInviteUrl}" style="display:inline-block;padding:13px 20px;border-radius:7px;color:#ffffff;font-size:15px;font-weight:750;line-height:20px;text-decoration:none;">Chấp nhận lời mời</a>
            </td></tr></table>
            <div style="margin:0;padding:14px 16px;border-left:3px solid #d9d6fe;background:#f7f6ff;color:#514a98;font-size:13px;line-height:1.55;">Liên kết này <strong>chỉ dùng một lần</strong> và hết hạn lúc ${tko_escapeHtml(tko_expiry)} UTC. Gửi lại lời mời sẽ thay thế liên kết cũ.</div>
            <p style="margin:26px 0 0;color:#667085;font-size:13px;line-height:1.55;">Nếu nút không hoạt động, hãy sao chép liên kết này vào trình duyệt:<br><a href="${tko_safeInviteUrl}" style="color:#5b51e8;word-break:break-all;">${tko_safeInviteUrl}</a></p>
          </td></tr>
          <tr><td style="padding:20px 36px;border-top:1px solid #eaecf0;background:#fcfcfd;color:#98a2b3;font-size:12px;line-height:1.5;">Tasko · Một workspace cho conversations, work và customers.<br>Nếu bạn không mong đợi email này, bạn có thể bỏ qua nó an toàn.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return { subject: tko_subject, text: tko_text, html: tko_html };
}

export async function sendWorkspaceInvitationEmail(tko_input: TkoWorkspaceInvitationEmailInput, tko_fetch: TkoFetch = fetch): Promise<void> {
  if (!tko_config.resendApiKey || !tko_config.resendFromEmail) throw new Error("TASKO_EMAIL_PROVIDER_NOT_CONFIGURED");
  const tko_email = buildWorkspaceInvitationEmail(tko_input);
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
      subject: tko_email.subject,
      html: tko_email.html,
      text: tko_email.text,
    }),
  });
  if (!tko_response.ok) throw new Error(`TASKO_EMAIL_PROVIDER_DELIVERY_FAILED:${tko_response.status}`);
}
