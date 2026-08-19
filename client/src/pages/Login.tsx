import { tko_brandAssets } from "@/components/TaskoShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function Login() {
  const [, tko_setLocation] = useLocation();
  const tko_utils = trpc.useUtils();
  const [tko_mode, tko_setMode] = useState<"signIn" | "signUp">("signIn");
  const [tko_email, tko_setEmail] = useState("");
  const [tko_password, tko_setPassword] = useState("");
  const [tko_displayName, tko_setDisplayName] = useState("");
  const [tko_workspaceName, tko_setWorkspaceName] = useState("");
  const [tko_error, tko_setError] = useState<string | null>(null);
  const tko_signIn = trpc.auth.signInWithEmailPassword.useMutation();
  const tko_signUp = trpc.auth.signUpWithEmailPassword.useMutation();
  const tko_pending = tko_signIn.isPending || tko_signUp.isPending;

  useEffect(() => { if (!tko_pending) return; tko_setError(null); }, [tko_pending]);

  async function tko_submit(tko_event: FormEvent<HTMLFormElement>) {
    tko_event.preventDefault();
    tko_setError(null);
    try {
      if (tko_mode === "signUp") {
        await tko_signUp.mutateAsync({ email: tko_email, password: tko_password, displayName: tko_displayName, workspaceName: tko_workspaceName || undefined });
      } else {
        await tko_signIn.mutateAsync({ email: tko_email, password: tko_password });
      }
      await tko_utils.auth.me.invalidate();
      tko_setLocation("/platform");
    } catch (tko_caught) {
      tko_setError(tko_caught instanceof Error ? tko_caught.message : "Không thể hoàn tất yêu cầu. Vui lòng thử lại.");
    }
  }

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
          <h2 className="mt-2 text-3xl font-semibold tracking-[-.03em] text-[#182230]">{tko_mode === "signIn" ? "Welcome back" : "Create your workspace"}</h2>
          <p className="mt-2 text-sm leading-6 text-[#667085]">{tko_mode === "signIn" ? "Sign in with your Tasko email and password." : "Start with a secure owner account for your team."}</p>
          <button type="button" onClick={() => startLogin()} className="mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#d0d5dd] bg-white text-sm font-semibold text-[#344054] shadow-sm transition hover:bg-[#f9fafb] active:scale-[.98]">
            Continue with Google <ArrowRight className="h-4 w-4" />
          </button>
          <div className="my-6 flex items-center gap-3 text-xs text-[#98a2b3]"><span className="h-px flex-1 bg-[#eaecf0]" />or continue with email<span className="h-px flex-1 bg-[#eaecf0]" /></div>
          <form className="space-y-4" onSubmit={tko_submit}>
            {tko_mode === "signUp" ? <div><label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="displayName">Your name</label><Input id="displayName" required value={tko_displayName} onChange={e => tko_setDisplayName(e.target.value)} placeholder="Alex Morgan" /></div> : null}
            {tko_mode === "signUp" ? <div><label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="workspaceName">Workspace name <span className="font-normal text-[#98a2b3]">(optional)</span></label><Input id="workspaceName" value={tko_workspaceName} onChange={e => tko_setWorkspaceName(e.target.value)} placeholder="Acme Operations" /></div> : null}
            <div><label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="email">Email</label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" /><Input id="email" type="email" autoComplete="email" required value={tko_email} onChange={e => tko_setEmail(e.target.value)} placeholder="you@company.com" className="pl-9" /></div></div>
            <div><label className="mb-1.5 block text-sm font-medium text-[#344054]" htmlFor="password">Password</label><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" /><Input id="password" type="password" autoComplete={tko_mode === "signIn" ? "current-password" : "new-password"} minLength={tko_mode === "signUp" ? 12 : 1} required value={tko_password} onChange={e => tko_setPassword(e.target.value)} placeholder={tko_mode === "signUp" ? "At least 12 characters" : "Your password"} className="pl-9" /></div>{tko_mode === "signUp" ? <p className="mt-1.5 text-xs text-[#98a2b3]">Use at least 12 characters.</p> : null}</div>
            {tko_error ? <p role="alert" className="rounded-lg border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#b42318]">{tko_error}</p> : null}
            <Button type="submit" disabled={tko_pending} className="h-11 w-full bg-[#5b51e8] text-sm font-semibold hover:bg-[#4d43da]">{tko_pending ? "Please wait…" : tko_mode === "signIn" ? "Sign in" : "Create workspace"}</Button>
          </form>
          <p className="mt-6 text-center text-sm text-[#667085]">{tko_mode === "signIn" ? "New to Tasko?" : "Already have an account?"} <button type="button" className="font-semibold text-[#5b51e8] hover:text-[#4d43da]" onClick={() => { tko_setError(null); tko_setMode(tko_mode === "signIn" ? "signUp" : "signIn"); }}>{tko_mode === "signIn" ? "Create a workspace" : "Sign in"}</button></p>
        </div>
      </section>
    </main>
  );
}
