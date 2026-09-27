import { tko_config } from "../../../packages/config/src/tasko-config";
import { tko_logger } from "../../../packages/observability/src/logger";

/**
 * Auth transactional email (password reset, email verification) for spec 06
 * §2 P1. Mirrors the Resend delivery pattern of
 * modules/workspace/src/invitation-email-service.ts (which is deliberately not
 * modified) with one difference: when the email provider is not configured the
 * email is written to the structured logger instead of throwing, and — ONLY
 * when NODE_ENV !== "production" — the caller may surface the one-time token
 * in its API response behind an explicit `devOnly` flag so the flows stay
 * testable. Tokens and links are never logged in production and never logged
 * at any level beyond the redacted structured event below.
 */

type TkoFetch = typeof fetch;

export interface TkoAuthEmailDelivery {
  /** True when Resend accepted the message; false when logged/fallback or failed. */
  delivered: boolean;
  providerConfigured: boolean;
}

function tko_escapeHtml(tko_value: string): string {
  return tko_value.replace(/[&<>'"]/g, tko_character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[tko_character] ?? tko_character);
}

function tko_shell(tko_input: { heading: string; introHtml: string; ctaUrl: string; ctaLabel: string; noteHtml: string }): { html: string; text: string } {
  const tko_safeUrl = tko_escapeHtml(tko_input.ctaUrl);
  return {
    html: `<!doctype html>
<html lang="vi">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f5f7fb;color:#182230;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
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
            <h1 style="margin:0;color:#182230;font-size:26px;line-height:1.24;letter-spacing:-0.6px;">${tko_escapeHtml(tko_input.heading)}</h1>
            <p style="margin:18px 0 0;color:#475467;font-size:16px;line-height:1.65;">${tko_input.introHtml}</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;"><tr><td style="border-radius:7px;background:#5b51e8;">
              <a href="${tko_safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:7px;color:#ffffff;font-size:15px;font-weight:750;line-height:20px;text-decoration:none;">${tko_escapeHtml(tko_input.ctaLabel)}</a>
            </td></tr></table>
            <div style="margin:0;padding:14px 16px;border-left:3px solid #d9d6fe;background:#f7f6ff;color:#514a98;font-size:13px;line-height:1.55;">${tko_input.noteHtml}</div>
            <p style="margin:26px 0 0;color:#667085;font-size:13px;line-height:1.55;">Nếu nút không hoạt động, hãy sao chép liên kết này vào trình duyệt:<br><a href="${tko_safeUrl}" style="color:#5b51e8;word-break:break-all;">${tko_safeUrl}</a></p>
          </td></tr>
          <tr><td style="padding:20px 36px;border-top:1px solid #eaecf0;background:#fcfcfd;color:#98a2b3;font-size:12px;line-height:1.5;">Tasko · Một workspace cho conversations, work và customers.<br>Nếu bạn không mong đợi email này, bạn có thể bỏ qua nó an toàn.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    text: `${tko_input.heading}\n${tko_input.ctaUrl}\n`,
  };
}

/**
 * Reset links land on the Login page (the only unauthenticated route Tasko
 * ships) carrying the one-time token: `${appOrigin}/login?resetToken=...`.
 * The Login page also accepts `?token=` for compatibility with the spec's
 * `/reset-password?token=...` shape.
 */
export function tko_passwordResetUrl(tko_token: string): string {
  if (!tko_config.appOrigin) throw new Error("TASKO_EMAIL_APP_ORIGIN_REQUIRED");
  const tko_url = new URL("/login", tko_config.appOrigin);
  tko_url.searchParams.set("resetToken", tko_token);
  return tko_url.toString();
}

export function tko_emailVerificationUrl(tko_token: string): string {
  if (!tko_config.appOrigin) throw new Error("TASKO_EMAIL_APP_ORIGIN_REQUIRED");
  const tko_url = new URL("/login", tko_config.appOrigin);
  tko_url.searchParams.set("verifyToken", tko_token);
  return tko_url.toString();
}

export function buildPasswordResetEmail(tko_input: { resetUrl: string; expiresAt: Date }) {
  const tko_expiry = new Date(tko_input.expiresAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  return tko_shell({
    heading: "Đặt lại mật khẩu Tasko",
    introHtml: `Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Tasko của bạn.`,
    ctaUrl: tko_input.resetUrl,
    ctaLabel: "Đặt lại mật khẩu",
    noteHtml: `Liên kết này <strong>chỉ dùng một lần</strong> và hết hạn lúc ${tko_escapeHtml(tko_expiry)} UTC. Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn hoạt động.`,
  });
}

export function buildEmailVerificationEmail(tko_input: { verifyUrl: string; expiresAt: Date }) {
  const tko_expiry = new Date(tko_input.expiresAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  return tko_shell({
    heading: "Xác thực email Tasko",
    introHtml: `Xác nhận địa chỉ email của bạn để hoàn tất thiết lập tài khoản Tasko.`,
    ctaUrl: tko_input.verifyUrl,
    ctaLabel: "Xác thực email",
    noteHtml: `Liên kết này <strong>chỉ dùng một lần</strong> và hết hạn lúc ${tko_escapeHtml(tko_expiry)} UTC.`,
  });
}

/**
 * Sends via Resend when configured; otherwise logs a redacted structured
 * event and reports `delivered: false` (never throws for missing config —
 * callers keep flows testable in development). Provider delivery failures are
 * logged and reported, not thrown, so recovery endpoints never leak account
 * existence through error behavior.
 */
export async function tko_sendAuthEmail(
  tko_input: { to: string; subject: string; html: string; text: string; idempotencyKey: string },
  tko_fetch: TkoFetch = fetch,
): Promise<TkoAuthEmailDelivery> {
  if (!tko_config.resendApiKey || !tko_config.resendFromEmail) {
    tko_logger.info({ authEmail: { to: tko_input.to, subject: tko_input.subject, idempotencyKey: tko_input.idempotencyKey, transport: "logger-fallback" } }, "auth email not delivered: RESEND not configured");
    return { delivered: false, providerConfigured: false };
  }
  try {
    const tko_response = await tko_fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tko_config.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": tko_input.idempotencyKey,
      },
      body: JSON.stringify({
        from: tko_config.resendFromEmail,
        to: [tko_input.to],
        subject: tko_input.subject,
        html: tko_input.html,
        text: tko_input.text,
      }),
    });
    if (!tko_response.ok) {
      tko_logger.error({ authEmail: { to: tko_input.to, idempotencyKey: tko_input.idempotencyKey, status: tko_response.status } }, "auth email delivery failed");
      return { delivered: false, providerConfigured: true };
    }
    return { delivered: true, providerConfigured: true };
  } catch (tko_error) {
    tko_logger.error({ authEmail: { to: tko_input.to, idempotencyKey: tko_input.idempotencyKey }, error: String(tko_error) }, "auth email delivery errored");
    return { delivered: false, providerConfigured: true };
  }
}

/** Whether `devOnly` token exposure is permitted (never in production). */
export function tko_devTokenExposureAllowed(): boolean {
  return !tko_config.isProduction && process.env.NODE_ENV !== "production";
}

/** Whether Resend delivery is configured (links are absolute only in that case). */
export function tko_authEmailProviderConfigured(): boolean {
  return Boolean(tko_config.resendApiKey && tko_config.resendFromEmail);
}
