import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TkoProjectInvitationActivityPanel } from "./Work";

const tko_baseProps = {
  tko_projectId: "project-1",
  tko_invitations: [],
  tko_activity: [],
  tko_activityMembers: [],
  tko_activityFilter: { actorMemberId: "", action: "", from: "", to: "" },
  tko_hasMoreActivity: false,
  tko_loadingMoreActivity: false,
  tko_activityState: "empty",
  tko_pending: false,
  tko_lastInvitation: null,
  tko_onCreate: () => undefined,
  tko_onRevoke: () => undefined,
  tko_onResend: () => undefined,
  tko_onActivityFilterChange: () => undefined,
  tko_onLoadMoreActivity: () => undefined,
  tko_onRetryActivity: () => undefined,
} as ComponentProps<typeof TkoProjectInvitationActivityPanel>;

function tko_render(tko_props: Partial<ComponentProps<typeof TkoProjectInvitationActivityPanel>>) {
  return renderToStaticMarkup(createElement(TkoProjectInvitationActivityPanel, { ...tko_baseProps, ...tko_props }));
}

describe("TkoProjectInvitationActivityPanel", () => {
  it("renders first-page loading and error/retry independently from an empty feed", () => {
    const tko_loading = tko_render({ tko_activityState: "loading" });
    expect(tko_loading).toContain("Loading permission activity…");
    expect(tko_loading).not.toContain("No permission changes match the selected filters.");

    const tko_error = tko_render({ tko_activityState: "error" });
    expect(tko_error).toContain("Permission activity could not be loaded.");
    expect(tko_error).toContain("Retry");
  });

  it("renders empty, next-page and end-of-history activity states", () => {
    expect(tko_render({ tko_activityState: "empty" })).toContain("No permission changes match the selected filters.");
    const tko_entry = { id: "audit-1", actorDisplayName: "Alex", action: "work.project.member_upserted", metadata: {}, createdAt: new Date("2026-08-21T00:00:00.000Z") };
    expect(tko_render({ tko_activityState: "ready", tko_activity: [tko_entry] as ComponentProps<typeof TkoProjectInvitationActivityPanel>["tko_activity"], tko_hasMoreActivity: true, tko_loadingMoreActivity: true })).toContain("Loading earlier activity…");
    expect(tko_render({ tko_activityState: "ready", tko_activity: [tko_entry] as ComponentProps<typeof TkoProjectInvitationActivityPanel>["tko_activity"] })).toContain("End of activity history");
  });
});
