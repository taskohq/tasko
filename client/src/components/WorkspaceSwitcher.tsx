import { useState } from "react";
import { trpc, tko_getActiveWorkspaceSlug, tko_setActiveWorkspaceSlug } from "@/lib/trpc";
import { Check, ChevronDown, Grid2X2 } from "lucide-react";

/** Workspace switcher (spec 17 §3/§4). Rendered only in the SaaS deployment profile and only when
 * the caller belongs to more than one workspace. The chosen slug is persisted to localStorage
 * (`tasko.workspace`) and sent as the `x-tasko-workspace` candidate header on every tRPC call;
 * the server always re-verifies membership before honoring it. Switching reloads the page so all
 * open queries resolve against the newly selected workspace. */

interface TkoMembershipView {
  slug: string;
  name: string;
  role: string;
  status: string;
}

export function tko_effectiveWorkspaceSlug(tko_memberships: ReadonlyArray<TkoMembershipView>): string | null {
  const tko_stored = tko_getActiveWorkspaceSlug();
  if (tko_stored && tko_memberships.some(tko_membership => tko_membership.slug === tko_stored)) return tko_stored;
  return tko_memberships[0]?.slug ?? null;
}

export default function WorkspaceSwitcher() {
  const [tko_open, tko_setOpen] = useState(false);
  const tko_status = trpc.platform.status.useQuery(undefined, { staleTime: 60_000, retry: false });
  const tko_isSaas = tko_status.data?.deploymentProfile === "saas";
  const tko_memberships = trpc.platform.memberships.useQuery(undefined, { enabled: tko_isSaas, retry: false, staleTime: 30_000 });
  if (!tko_isSaas || !tko_memberships.data || tko_memberships.data.length <= 1) return null;

  const tko_views: TkoMembershipView[] = tko_memberships.data
    .filter(tko_membership => tko_membership.status === "active")
    .map(tko_membership => ({ slug: tko_membership.tenant.slug, name: tko_membership.tenant.name, role: tko_membership.role, status: tko_membership.status }));
  if (tko_views.length <= 1) return null;

  const tko_activeSlug = tko_effectiveWorkspaceSlug(tko_views);
  const tko_active = tko_views.find(tko_view => tko_view.slug === tko_activeSlug);

  const tko_switch = (tko_slug: string) => {
    tko_setOpen(false);
    if (tko_slug === tko_activeSlug) return;
    tko_setActiveWorkspaceSlug(tko_slug);
    window.location.reload();
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={tko_open}
        aria-label="Switch workspace"
        onClick={() => tko_setOpen(tko_current => !tko_current)}
        className="hidden items-center gap-2 border border-[#dfe1e6] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[#172b4d] lg:flex"
      >
        <Grid2X2 className="h-4 w-4 text-[#5e6c84]" />
        <span className="max-w-[160px] truncate">{tko_active?.name ?? "Workspace"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#98a2b3]" />
      </button>
      {tko_open ? (
        <div role="listbox" aria-label="Workspaces" className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-[#eaecf0] bg-white p-1.5 shadow-[0_12px_32px_rgba(16,24,40,.14)]">
          {tko_views.map(tko_view => {
            const tko_selected = tko_view.slug === tko_activeSlug;
            return (
              <button
                key={tko_view.slug}
                type="button"
                role="option"
                aria-selected={tko_selected}
                onClick={() => tko_switch(tko_view.slug)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f4f5f7] ${tko_selected ? "bg-[#deebff]" : ""}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f0efff] text-xs font-bold text-[#5b51e8]">{tko_view.name.slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#344054]">{tko_view.name}</span>
                  <span className="block truncate text-xs text-[#98a2b3]">{tko_view.slug} · {tko_view.role}</span>
                </span>
                {tko_selected ? <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
