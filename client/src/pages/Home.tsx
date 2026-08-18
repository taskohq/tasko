import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  CircleDotDashed,
  Database,
  LockKeyhole,
  Radio,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

function HealthDot({ status }: { status: "ok" | "error" | "degraded" }) {
  const tko_style =
    status === "ok"
      ? "bg-emerald-500"
      : status === "degraded"
        ? "bg-amber-500"
        : "bg-rose-500";
  return <span aria-hidden="true" className={`h-2 w-2 rounded-full ${tko_style}`} />;
}

/**
 * All content in this page are only for example, replace with your own feature implementation
 * When building pages, remember your instructions in Frontend Workflow, Frontend Best Practices, Design Guide and Common Pitfalls
 */
export default function Home() {
  // The useAuth hook provides authentication state.
  // To implement login/logout, call logout(), or start login from an event
  // handler: onClick={() => startLogin()} (imported from "@/const"). Never call
  // startLogin() during render (no href={startLogin()}) — it mints a one-time
  // nonce cookie and must run only at the moment of navigation.
  const { user, loading: tko_authLoading, isAuthenticated } = useAuth();
  const tko_platformQuery = trpc.platform.status.useQuery(undefined, { refetchInterval: 20_000 });
  const tko_status = tko_platformQuery.data;
  const tko_statusText = tko_platformQuery.isLoading ? "Đang kiểm tra" : "M0 platform skeleton";
  const tko_checks = [
    {
      label: "PostgreSQL",
      value: tko_status?.database.detail ?? "Đang chờ kiểm tra",
      status: tko_status?.database.status ?? "degraded",
      icon: Database,
    },
    {
      label: "Redis pub/sub",
      value: "Sẵn sàng cho tenant-scoped events",
      status: "ok" as const,
      icon: Radio,
    },
    {
      label: "Outbox worker",
      value: "Retry & dead-letter boundary đã định nghĩa",
      status: "ok" as const,
      icon: RefreshCw,
    },
  ];

  return (
    <div className="min-h-screen bg-[#f5f7f6] text-[#17201d]">
      <div className="mx-auto flex min-h-screen max-w-[1480px] flex-col px-4 py-4 md:px-7 md:py-7">
        <header className="flex items-center justify-between border border-[#d8dfda] bg-white px-4 py-3 md:px-5">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center bg-[#144a3c] text-sm font-bold text-white">T</div>
            <div>
              <p className="text-sm font-semibold tracking-tight">Tasko</p>
              <p className="text-[11px] uppercase tracking-[0.12em] text-[#65726c]">Work Operations Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[#65726c] sm:inline">{tko_statusText}</span>
            {isAuthenticated ? (
              <span className="border border-[#d8dfda] px-2.5 py-1 text-xs font-medium">{user?.name ?? "Authenticated"}</span>
            ) : (
              <Button onClick={() => startLogin()} className="rounded-none bg-[#144a3c] text-white hover:bg-[#0f3d31]">
                Đăng nhập <ArrowUpRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        <main className="grid flex-1 grid-cols-1 border-x border-b border-[#d8dfda] bg-white lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="border-b border-[#d8dfda] p-5 lg:border-b-0 lg:border-r">
            <div className="mb-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-[#65726c]">
              <CircleDotDashed className="h-3.5 w-3.5" /> M0 / Foundation
            </div>
            <nav className="space-y-1" aria-label="Platform navigation">
              <a className="flex items-center gap-3 border-l-2 border-[#144a3c] bg-[#edf5f0] px-3 py-2.5 text-sm font-medium" href="#overview">
                <Boxes className="h-4 w-4" /> Tổng quan
              </a>
              <a className="flex items-center gap-3 px-3 py-2.5 text-sm text-[#65726c] hover:bg-[#f5f7f6]" href="#guardrails">
                <ShieldCheck className="h-4 w-4" /> Security boundary
              </a>
              <a className="flex items-center gap-3 px-3 py-2.5 text-sm text-[#65726c] hover:bg-[#f5f7f6]" href="#operations">
                <ServerCog className="h-4 w-4" /> Operations
              </a>
            </nav>
            <div className="mt-10 border-t border-[#d8dfda] pt-5">
              <p className="text-xs font-medium text-[#65726c]">Deployment profile</p>
              <p className="mt-1 font-mono text-sm font-semibold text-[#144a3c]">{tko_status?.deploymentProfile ?? "single_tenant"}</p>
            </div>
          </aside>

          <section id="overview" className="p-5 md:p-8">
            <div className="flex flex-col justify-between gap-6 border-b border-[#d8dfda] pb-7 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#31735e]">Platform foundation</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">One workspace for conversations, work and customers.</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[#65726c]">M0 thiết lập một core tenant-aware, không mở sớm các màn hình Work, Chat hoặc CRM. Các domain sau này dùng chung authentication, authorization, outbox và operational boundaries bên dưới.</p>
              </div>
              <div className="flex items-center gap-2 border border-[#cce0d5] bg-[#f4faf6] px-3 py-2 text-sm text-[#27634f]">
                <CheckCircle2 className="h-4 w-4" /> API runtime available
              </div>
            </div>

            <div className="mt-7 grid gap-px border border-[#d8dfda] bg-[#d8dfda] md:grid-cols-3">
              {tko_checks.map(tko_check => (
                <article key={tko_check.label} className="bg-white p-5">
                  <div className="flex items-center justify-between">
                    <tko_check.icon className="h-4 w-4 text-[#31735e]" />
                    <HealthDot status={tko_check.status} />
                  </div>
                  <p className="mt-7 text-sm font-semibold">{tko_check.label}</p>
                  <p className="mt-1.5 text-xs leading-5 text-[#65726c]">{tko_check.value}</p>
                </article>
              ))}
            </div>

            <div id="guardrails" className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
              <article className="border border-[#d8dfda] p-5 md:p-6">
                <div className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="h-4 w-4 text-[#31735e]" /> Tenant security contract</div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#65726c]">Membership resolution</p><p className="mt-1.5 text-sm leading-6">Tenant hint từ browser chỉ là candidate. Server chọn tenant sau khi đối chiếu active membership.</p></div>
                  <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#65726c]">Authorization</p><p className="mt-1.5 text-sm leading-6">RBAC dùng một primitive chung cho HTTP, WebSocket và worker payload.</p></div>
                </div>
              </article>
              <article id="operations" className="border border-[#d8dfda] bg-[#fbfcfb] p-5 md:p-6">
                <div className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="h-4 w-4 text-[#31735e]" /> Next operator action</div>
                <p className="mt-4 text-sm leading-6 text-[#65726c]">Cấu hình PostgreSQL và Redis qua secrets, chạy migration + seed, sau đó chạy worker ở process bền vững khi cần realtime liên tục.</p>
                {tko_authLoading ? <p className="mt-5 text-xs text-[#65726c]">Đang kiểm tra session…</p> : null}
              </article>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
