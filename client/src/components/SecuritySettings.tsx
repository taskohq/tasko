import { tko_authExtrasHooks } from "@/lib/auth-extras-trpc";
import { trpc } from "@/lib/trpc";
import { BadgeCheck, Copy, KeyRound, MailWarning, ShieldCheck, ShieldOff } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

/**
 * Account security settings (spec 06 §2 P1): password change, email
 * verification status/resend and TOTP multi-factor enrollment/disable with
 * one-time recovery-code display. The orchestrator mounts this component into
 * client/src/pages/Settings.tsx:
 *
 *   import SecuritySettings from "@/components/SecuritySettings";
 *   ...
 *   <SecuritySettings />
 *
 * All procedure calls go through lib/auth-extras-trpc.ts, which maps onto
 * server/routers.auth-extras.ts (spread into the `auth:` section of appRouter).
 */

function TkoPasswordChangeCard() {
  const tko_extras = tko_authExtrasHooks(trpc.auth);
  const [tko_currentPassword, tko_setCurrentPassword] = useState("");
  const [tko_newPassword, tko_setNewPassword] = useState("");
  const [tko_confirmPassword, tko_setConfirmPassword] = useState("");
  const tko_change = tko_extras.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password changed. Other devices have been signed out.");
      tko_setCurrentPassword("");
      tko_setNewPassword("");
      tko_setConfirmPassword("");
    },
    onError: tko_error => {
      if (tko_error.message.includes("security requirements")) toast.error("New password must be 12–128 characters.");
      else toast.error("Current password is incorrect.");
    },
  });

  function tko_submit(tko_event: FormEvent<HTMLFormElement>) {
    tko_event.preventDefault();
    if (tko_newPassword !== tko_confirmPassword) {
      toast.error("The new passwords do not match.");
      return;
    }
    tko_change.mutate({ currentPassword: tko_currentPassword, newPassword: tko_newPassword });
  }

  return (
    <section className="mt-5 rounded-xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]">
      <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-[#5b51e8]" /><h2 className="font-semibold text-[#182230]">Password</h2></div>
      <p className="mt-1 text-xs text-[#667085]">Changing your password keeps this device signed in and signs out every other session.</p>
      <form onSubmit={tko_submit} className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-[#475467]"><span>Current password</span><input type="password" autoComplete="current-password" required value={tko_currentPassword} onChange={tko_event => tko_setCurrentPassword(tko_event.target.value)} className="h-10 rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-normal outline-none focus:border-[#766df0]" /></label>
        <label className="grid gap-1 text-xs font-semibold text-[#475467]"><span>New password (12+ characters)</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={tko_newPassword} onChange={tko_event => tko_setNewPassword(tko_event.target.value)} className="h-10 rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-normal outline-none focus:border-[#766df0]" /></label>
        <label className="grid gap-1 text-xs font-semibold text-[#475467]"><span>Confirm new password</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={tko_confirmPassword} onChange={tko_event => tko_setConfirmPassword(tko_event.target.value)} className="h-10 rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-normal outline-none focus:border-[#766df0]" /></label>
        <div className="md:col-span-3"><button type="submit" disabled={tko_change.isPending} className="inline-flex h-10 items-center justify-center rounded-md bg-[#5b51e8] px-4 text-sm font-semibold text-white transition hover:bg-[#4d43da] disabled:opacity-60">{tko_change.isPending ? "Updating…" : "Change password"}</button></div>
      </form>
    </section>
  );
}

function TkoEmailVerificationCard() {
  const tko_extras = tko_authExtrasHooks(trpc.auth);
  const tko_me = tko_extras.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const tko_resend = tko_extras.resendVerificationEmail.useMutation({
    onSuccess: tko_result => {
      if (tko_result.alreadyVerified) toast.success("Your email is already verified.");
      else toast.success("Verification email sent. Please check your inbox.");
    },
    onError: () => toast.error("Could not send the verification email. Please wait a moment and retry."),
  });

  const tko_emailVerified = tko_me.data?.emailVerified ?? null;
  if (tko_emailVerified === null) return null; // OAuth-only account: no email/password verification state

  return (
    <section className="mt-5 rounded-xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">{tko_emailVerified ? <BadgeCheck className="h-4 w-4 text-[#027a48]" /> : <MailWarning className="h-4 w-4 text-[#b54708]" />}<h2 className="font-semibold text-[#182230]">Email verification</h2></div>
          <p className="mt-1 text-xs text-[#667085]">{tko_me.data?.email ? <>Address <span className="font-semibold text-[#344054]">{tko_me.data.email}</span></> : null}{tko_emailVerified ? " is verified." : " is not verified yet. Verify it to keep your account recoverable."}</p>
        </div>
        {tko_emailVerified ? (
          <span className="rounded-full bg-[#ecfdf3] px-2.5 py-1 text-xs font-semibold text-[#027a48]">Verified</span>
        ) : (
          <button type="button" disabled={tko_resend.isPending} onClick={() => tko_resend.mutate()} className="inline-flex h-9 items-center justify-center rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f9fafb] disabled:opacity-60">{tko_resend.isPending ? "Sending…" : "Resend verification email"}</button>
        )}
      </div>
    </section>
  );
}

function TkoMfaCard() {
  const tko_extras = tko_authExtrasHooks(trpc.auth);
  const tko_status = tko_extras.mfaStatus.useQuery(undefined, { retry: false });
  const [tko_enrolling, tko_setEnrolling] = useState(false);
  const [tko_secret, tko_setSecret] = useState<string | null>(null);
  const [tko_otpauthUri, tko_setOtpauthUri] = useState<string | null>(null);
  const [tko_code, tko_setCode] = useState("");
  const [tko_recoveryCodes, tko_setRecoveryCodes] = useState<string[] | null>(null);
  const [tko_disablePassword, tko_setDisablePassword] = useState("");
  const [tko_disabling, tko_setDisabling] = useState(false);

  const tko_start = tko_extras.mfaStartEnrollment.useMutation({
    onSuccess: tko_result => { tko_setSecret(tko_result.secret); tko_setOtpauthUri(tko_result.otpauthUri); tko_setEnrolling(true); },
    onError: () => toast.error("Could not start two-factor enrollment."),
  });
  const tko_confirm = tko_extras.mfaConfirmEnrollment.useMutation({
    onSuccess: tko_result => {
      tko_setRecoveryCodes(tko_result.recoveryCodes);
      tko_setEnrolling(false);
      tko_setSecret(null);
      tko_setOtpauthUri(null);
      tko_setCode("");
      toast.success("Two-factor authentication enabled.");
      void tko_status.refetch();
    },
    onError: () => toast.error("That code is not valid. Check your authenticator app and try again."),
  });
  const tko_disable = tko_extras.mfaDisable.useMutation({
    onSuccess: () => {
      toast.success("Two-factor authentication disabled.");
      tko_setDisabling(false);
      tko_setDisablePassword("");
      void tko_status.refetch();
    },
    onError: () => toast.error("Could not disable two-factor authentication. Check your password."),
  });

  const tko_enabled = tko_status.data?.enabled === true;

  function tko_copyRecoveryCodes() {
    if (!tko_recoveryCodes) return;
    void navigator.clipboard?.writeText(tko_recoveryCodes.join("\n")).then(() => toast("Recovery codes copied. Store them somewhere safe."));
  }

  return (
    <section className="mt-5 rounded-xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#5b51e8]" /><h2 className="font-semibold text-[#182230]">Two-factor authentication</h2></div>
          <p className="mt-1 text-xs text-[#667085]">Require a 6-digit authenticator code (TOTP) at every sign-in. Recovery codes let you back in if you lose the device.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tko_enabled ? "bg-[#ecfdf3] text-[#027a48]" : "bg-[#f9fafb] text-[#667085]"}`}>{tko_status.isLoading ? "…" : tko_enabled ? "Enabled" : "Disabled"}</span>
      </div>

      {tko_enabled ? (
        tko_disabling ? (
          <form onSubmit={tko_event => { tko_event.preventDefault(); tko_disable.mutate({ password: tko_disablePassword }); }} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-[#fecaca] bg-[#fffbfa] p-3">
            <label className="grid flex-1 gap-1 text-xs font-semibold text-[#b42318]"><span>Confirm your current password to disable 2FA</span><input type="password" autoComplete="current-password" required value={tko_disablePassword} onChange={tko_event => tko_setDisablePassword(tko_event.target.value)} className="h-10 rounded-md border border-[#d0d5dd] bg-white px-3 text-sm font-normal outline-none focus:border-[#766df0]" /></label>
            <button type="submit" disabled={tko_disable.isPending} className="h-10 rounded-md bg-[#b42318] px-4 text-sm font-semibold text-white transition hover:bg-[#912018] disabled:opacity-60"><span className="inline-flex items-center gap-1.5"><ShieldOff className="h-4 w-4" />{tko_disable.isPending ? "Disabling…" : "Disable 2FA"}</span></button>
            <button type="button" onClick={() => tko_setDisabling(false)} className="h-10 rounded-md border border-[#d0d5dd] px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f9fafb]">Cancel</button>
          </form>
        ) : (
          <div className="mt-4"><button type="button" onClick={() => tko_setDisabling(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#fecaca] bg-[#fff7f7] px-3 text-sm font-semibold text-[#b42318] transition hover:bg-[#fef3f2]"><ShieldOff className="h-4 w-4" />Disable two-factor</button></div>
        )
      ) : tko_recoveryCodes ? (
        <div className="mt-4 rounded-lg border border-[#d9d6fe] bg-[#f5f3ff] p-4">
          <p className="text-sm font-semibold text-[#182230]">Save your recovery codes now — they are shown only once.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-[#182230] sm:grid-cols-4">{tko_recoveryCodes.map(tko_recovery => <span key={tko_recovery} className="rounded bg-white px-2 py-1.5">{tko_recovery}</span>)}</div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={tko_copyRecoveryCodes} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#5b51e8] px-3 text-sm font-semibold text-white transition hover:bg-[#4d43da]"><Copy className="h-4 w-4" />Copy codes</button>
            <button type="button" onClick={() => tko_setRecoveryCodes(null)} className="h-9 rounded-md border border-[#d0d5dd] px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f9fafb]">Done</button>
          </div>
        </div>
      ) : tko_enrolling && tko_secret ? (
        <form onSubmit={tko_event => { tko_event.preventDefault(); tko_confirm.mutate({ code: tko_code.trim() }); }} className="mt-4 space-y-3 rounded-lg border border-[#eaecf0] bg-[#fcfcfd] p-4">
          <ol className="list-decimal space-y-1 pl-5 text-xs leading-5 text-[#475467]">
            <li>Open your authenticator app (Google Authenticator, 1Password, Authy…).</li>
            <li>Add an account by scanning or typing the secret below.</li>
            <li>Enter the current 6-digit code to confirm.</li>
          </ol>
          <div className="rounded-md bg-white p-3 font-mono text-sm tracking-wide text-[#182230]">{tko_secret}</div>
          {tko_otpauthUri ? <p className="break-all text-[11px] text-[#98a2b3]">{tko_otpauthUri}</p> : null}
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs font-semibold text-[#475467]"><span>6-digit code</span><input required inputMode="numeric" pattern="\d{6}" maxLength={6} value={tko_code} onChange={tko_event => tko_setCode(tko_event.target.value)} className="h-10 w-36 rounded-md border border-[#d0d5dd] bg-white px-3 font-mono text-sm tracking-[.3em] outline-none focus:border-[#766df0]" /></label>
            <button type="submit" disabled={tko_confirm.isPending} className="h-10 rounded-md bg-[#5b51e8] px-4 text-sm font-semibold text-white transition hover:bg-[#4d43da] disabled:opacity-60">{tko_confirm.isPending ? "Verifying…" : "Confirm and enable"}</button>
            <button type="button" onClick={() => { tko_setEnrolling(false); tko_setSecret(null); tko_setOtpauthUri(null); tko_setCode(""); }} className="h-10 rounded-md border border-[#d0d5dd] px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f9fafb]">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <button type="button" disabled={tko_start.isPending} onClick={() => tko_start.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#5b51e8] px-3 text-sm font-semibold text-white transition hover:bg-[#4d43da] disabled:opacity-60">{tko_start.isPending ? "Preparing…" : "Enable two-factor"}</button>
        </div>
      )}
    </section>
  );
}

export default function SecuritySettings() {
  return (
    <div>
      <TkoEmailVerificationCard />
      <TkoPasswordChangeCard />
      <TkoMfaCard />
    </div>
  );
}
