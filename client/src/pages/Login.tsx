import { tko_brandAssets } from "@/components/TaskoShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startLogin } from "@/const";
import { tko_authExtrasHooks, type TkoAuthMfaChallengeResponse } from "@/lib/auth-extras-trpc";
import { tko_parseAuthRecoveryParams } from "@/lib/auth-recovery-params";
import { trpc } from "@/lib/trpc";
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

type TkoLoginMode = "signIn" | "signUp" | "forgot" | "reset" | "mfa";

export default function Login() {
  const [, tko_setLocation] = useLocation();
  const tko_utils = trpc.useUtils();
  const tko_extras = tko_authExtrasHooks(trpc.auth);
  // Password-reset and verification emails land here: /login?resetToken=... / /login?verifyToken=...
  const [tko_urlParams] = useState(() => tko_parseAuthRecoveryParams(typeof window === "undefined" ? "" : window.location.search));
  const [tko_mode, tko_setMode] = useState<TkoLoginMode>(tko_urlParams.resetToken ? "reset" : "signIn");
  const [tko_email, tko_setEmail] = useState("");
  const [tko_password, tko_setPassword] = useState("");
  const [tko_newPassword, tko_setNewPassword] = useState("");
  const [tko_displayName, tko_setDisplayName] = useState("");
  const [tko_workspaceName, tko_setWorkspaceName] = useState("");
  const [tko_mfaCode, tko_setMfaCode] = useState("");
  const [tko_challengeToken, tko_setChallengeToken] = useState<string | null>(null);
  const [tko_error, tko_setError] = useState<string | null>(null);
  const [tko_notice, tko_setNotice] = useState<string | null>(null);
  const [tko_devLink, tko_setDevLink] = useState<string | null>(null);
  const tko_verifyStarted = useRef(false);

  const tko_signIn = tko_extras.signInWithEmailPassword.useMutation();
  const tko_signUp = trpc.auth.signUpWithEmailPassword.useMutation();
  const tko_requestReset = tko_extras.requestPasswordReset.useMutation();
  const tko_reset = tko_extras.resetPassword.useMutation();
  const tko_verifyEmail = tko_extras.verifyEmail.useMutation();
  const tko_mfaVerify = tko_extras.mfaVerifyLogin.useMutation();
  const tko_pending = tko_signIn.isPending || tko_signUp.isPending || tko_requestReset.isPending || tko_reset.isPending || tko_mfaVerify.isPending;

  useEffect(() => { if (!tko_pending) return; tko_setError(null); }, [tko_pending]);

  // One-shot email verification when the page was opened from a verification link.
  useEffect(() => {
    if (!tko_urlParams.verifyToken || tko_verifyStarted.current) return;
    tko_verifyStarted.current = true;
    tko_setMode("signIn");
    tko_verifyEmail
      .mutateAsync({ token: tko_urlParams.verifyToken })
      .then(() => tko_setNotice("Email verified successfully. You can now sign in."))
      .catch(() => tko_setError("This email verification link is invalid or has expired."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tko_submit(tko_event: FormEvent<HTMLFormElement>) {
    tko_event.preventDefault();
    tko_setError(null);
    tko_setNotice(null);
    tko_setDevLink(null);
    try {
      if (tko_mode === "signUp") {
        await tko_signUp.mutateAsync({ email: tko_email, password: tko_password, displayName: tko_displayName, workspaceName: tko_workspaceName || undefined });
        await tko_utils.auth.me.invalidate();
        tko_setLocation("/platform");
      } else if (tko_mode === "forgot") {
        const tko_result = await tko_requestReset.mutateAsync({ email: tko_email });
        tko_setNotice(tko_result.success ? "If an account exists for that email, a reset link is on its way. Please check your inbox." : "If an account exists for that email, a reset link is on its way.");
        if (tko_result.devOnly?.resetToken) {
          tko_setDevLink(`${window.location.origin}/login?resetToken=${encodeURIComponent(tko_result.devOnly.resetToken)}`);
        }
      } else if (tko_mode === "reset") {
        if (!tko_urlParams.resetToken) {
          tko_setError("This reset link is missing its token. Request a new one.");
          return;
        }
        await tko_reset.mutateAsync({ token: tko_urlParams.resetToken, newPassword: tko_newPassword });
        await tko_utils.auth.me.invalidate();
        tko_setLocation("/platform");
      } else if (tko_mode === "mfa") {
        if (!tko_challengeToken) {
          tko_setError("Your sign-in session expired. Please sign in again.");
          tko_setMode("signIn");
          return;
        }
        await tko_mfaVerify.mutateAsync({ challengeToken: tko_challengeToken, code: tko_mfaCode });
        await tko_utils.auth.me.invalidate();
        tko_setLocation("/platform");
      } else {
        const tko_result = await tko_signIn.mutateAsync({ email: tko_email, password: tko_password });
        if ("mfaRequired" in tko_result && tko_result.mfaRequired) {
          tko_setChallengeToken((tko_result as TkoAuthMfaChallengeResponse).challengeToken);
          tko_setMfaCode("");
          tko_setMode("mfa");
          return;
        }
        await tko_utils.auth.me.invalidate();
        tko_setLocation("/platform");
      }
    } catch (tko_caught) {
      tko_setError(tko_caught instanceof Error ? tko_caught.message : "Không thể hoàn tất yêu cầu. Vui lòng thử lại.");
    }
  }

  const tko_heading: Record<TkoLoginMode, string> = {
    signIn: "Welcome back",
    signUp: "Create your workspace",
    forgot: "Reset your password",
    reset: "Choose a new password",
    mfa: "Two-factor authentication",
  };
  const tko_subheading: Record<TkoLoginMode, string> = {
    signIn: "Sign in with your Tasko email and password.",
    signUp: "Start with a secure owner account for your team.",
    forgot: "Enter your email and we will send a one-time reset link.",
    reset: "Enter a new password for your account (at least 12 characters).",
    mfa: "Enter the 6-digit code from your authenticator app, or a recovery code.",
  };

  return (
    <main className="grid min-h-screen bg-[#f8f8fc] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-[#1b1643] px-12 py-14 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(139,92,246,.42),transparent_29%),radial-gradient(circle_at_82%_78%,rgba(91,81,232,.34),transparent_26%)]" />
        <img src={tko_brandAssets.logo} alt="Tasko" className="relative h-9 w-auto self-start brightness-0 invert" />
        <div className="relative my-auto max-w-md">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-violet-100"><Sparkles className="h-3.5 w-3.5" /> Work operations, in one place</span>
          <h1 className="text-4xl font-semibold leading-[1.12] tracking-[-.03em]">Move work forward with clear context.</h1>
          <p className="mt-5 max-w-sm text-[15px] leading-7 text-violet-100/80">Coordinate projects, conversations, customers and AI-assisted actions from one secure workspace.</p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-violet-100/70"><CheckCircle2 className="h-4 w-4 text-violet-300" /> Tenant-aware access and auditable operations</div>
      </section>
      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <img src={tko_brandAssets.logo} alt="Tasko" className="mb-10 h-8 w-auto lg:hidden" />
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#5b51e8]">Tasko workspace</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-.03em] text-[#182230]">{tko_heading[tko_mode]}</h2>
          <p className="mt-2 text-sm leading-6 text-[#667085]">{tko_subheading[tko_mode]}</p>
          {tko_mode === "signIn" ? (
            <button type="button" onClick={() => startLogin()} className="mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#d0d5dd] bg-white text-sm font-semibold text-[#344054] shadow-sm transition hover:bg-[#f9fafb] active:scale-[.98]">
              Continue with Google <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
          {tko_mode === "signIn" ? <div className="my-6 flex items-center gap-3 text-xs text-[#98a2b3]"><span className="h-px flex-1 bg-[#eaecf0]" />or continue with email<span className="h-px flex-1 bg-[#eaecf0]" /></div> : <div className="mt-7" />}
          <form className="space-y-4" onSubmit={tko_submit}>
            {tko_mode === "mfa" ? (
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[#344054]" htmlFor="mfaCode"><ShieldCheck className="h-4 w-4 text-[#5b51e8]" /> Authentication code</label>
                <Input id="mfaCode" required inputMode="text" autoComplete="one-time-code" autoFocus value={tko_mfaCode} onChange={e => tko_setMfaCode(e.target.value)} placeholder="123456 or a recovery code" />
              </div>
            ) : null}
            {tko_mode === "signUp" ? <div><label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="displayName">Your name</label><Input id="displayName" required value={tko_displayName} onChange={e => tko_setDisplayName(e.target.value)} placeholder="Alex Morgan" /></div> : null}
            {tko_mode === "signUp" ? <div><label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="workspaceName">Workspace name <span className="font-normal text-[#98a2b3]">(optional)</span></label><Input id="workspaceName" value={tko_workspaceName} onChange={e => tko_setWorkspaceName(e.target.value)} placeholder="Acme Operations" /></div> : null}
            {tko_mode === "signIn" || tko_mode === "signUp" || tko_mode === "forgot" ? (
              <div><label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="email">Email</label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" /><Input id="email" type="email" autoComplete="email" required value={tko_email} onChange={e => tko_setEmail(e.target.value)} placeholder="you@company.com" className="pl-9" /></div></div>
            ) : null}
            {tko_mode === "signIn" || tko_mode === "signUp" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="password">Password</label>
                <div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" /><Input id="password" type="password" autoComplete={tko_mode === "signIn" ? "current-password" : "new-password"} minLength={tko_mode === "signUp" ? 12 : 1} required value={tko_password} onChange={e => tko_setPassword(e.target.value)} placeholder={tko_mode === "signUp" ? "At least 12 characters" : "Your password"} className="pl-9" /></div>
                {tko_mode === "signUp" ? <p className="mt-1.5 text-xs text-[#98a2b3]">Use at least 12 characters.</p> : null}
              </div>
            ) : null}
            {tko_mode === "reset" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="newPassword">New password</label>
                <div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" /><Input id="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={tko_newPassword} onChange={e => tko_setNewPassword(e.target.value)} placeholder="At least 12 characters" className="pl-9" /></div>
                <p className="mt-1.5 text-xs text-[#98a2b3]">Signing you in everywhere else will be signed out for safety.</p>
              </div>
            ) : null}
            {tko_notice ? <p role="status" className="rounded-lg border border-[#abefc6] bg-[#ecfdf3] px-3 py-2 text-sm text-[#027a48]">{tko_notice}</p> : null}
            {tko_devLink ? <p className="rounded-lg border border-[#d9d6fe] bg-[#f5f3ff] px-3 py-2 text-xs text-[#4d43da]"><span className="font-semibold">Dev only</span> — email provider not configured, use this link: <a href={tko_devLink} className="break-all underline">{tko_devLink}</a></p> : null}
            {tko_error ? <p role="alert" className="rounded-lg border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#b42318]">{tko_error}</p> : null}
            <Button type="submit" disabled={tko_pending} className="h-11 w-full bg-[#5b51e8] text-sm font-semibold hover:bg-[#4d43da]">
              {tko_pending ? "Please wait…" : tko_mode === "signIn" ? "Sign in" : tko_mode === "signUp" ? "Create workspace" : tko_mode === "forgot" ? "Send reset link" : tko_mode === "reset" ? "Set new password" : "Verify and sign in"}
            </Button>
          </form>
          {tko_mode === "mfa" ? (
            <p className="mt-6 text-center text-sm text-[#667085]">
              <button type="button" className="font-semibold text-[#5b51e8] hover:text-[#4d43da]" onClick={() => { tko_setChallengeToken(null); tko_setMfaCode(""); tko_setError(null); tko_setMode("signIn"); }}>Back to sign in</button>
            </p>
          ) : tko_mode === "forgot" || tko_mode === "reset" ? (
            <p className="mt-6 text-center text-sm text-[#667085]">
              <button type="button" className="font-semibold text-[#5b51e8] hover:text-[#4d43da]" onClick={() => { tko_setError(null); tko_setNotice(null); tko_setDevLink(null); tko_setMode("signIn"); }}>Back to sign in</button>
            </p>
          ) : (
            <div className="mt-6 space-y-2 text-center text-sm text-[#667085]">
              <p>{tko_mode === "signIn" ? "New to Tasko?" : "Already have an account?"} <button type="button" className="font-semibold text-[#5b51e8] hover:text-[#4d43da]" onClick={() => { tko_setError(null); tko_setMode(tko_mode === "signIn" ? "signUp" : "signIn"); }}>{tko_mode === "signIn" ? "Create a workspace" : "Sign in"}</button></p>
              {tko_mode === "signIn" ? <p><button type="button" className="font-semibold text-[#5b51e8] hover:text-[#4d43da]" onClick={() => { tko_setError(null); tko_setEmail(""); tko_setMode("forgot"); }}>Forgot your password?</button></p> : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
