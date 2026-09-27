import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TkoCrmLeadStatusChips, TkoCrmLeadTable } from "./TkoCrmLeads";
import { tko_conversionKey, tko_filterDeals, tko_leadFollowUpDue, type TkoCrmDeal, type TkoCrmLead } from "./TkoCrmShared";
import { TkoCrmWonLostDialog } from "./TkoCrmDeals";
import { TkoCrmTimeline } from "./TkoCrmShared";

function tko_lead(tko_overrides: Partial<TkoCrmLead> = {}): TkoCrmLead {
  return { id: "lead-1", firstName: "Avery", lastName: "Nguyen", companyName: "Northstar Labs", jobTitle: "CTO", email: "avery@northstar.test", phone: "+1 555 0100", website: "", country: "VN", source: "referral", status: "qualified", score: 82, tags: ["enterprise"], notes: "", nextFollowUpAt: null, ownerMemberId: "member-a", convertedAt: null, convertedCompanyId: null, convertedContactId: null, convertedDealId: null, updatedAt: new Date("2026-09-01T00:00:00.000Z"), ...tko_overrides };
}

describe("tko_conversionKey", () => {
  it("is a stable uuid v4-shaped key per member and lead", () => {
    const tko_first = tko_conversionKey("member-a", "lead-1");
    const tko_again = tko_conversionKey("member-a", "lead-1");
    expect(tko_first).toBe(tko_again);
    expect(tko_first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(tko_conversionKey("member-a", "lead-2")).not.toBe(tko_first);
    expect(tko_conversionKey("member-b", "lead-1")).not.toBe(tko_first);
  });
});

describe("tko_leadFollowUpDue", () => {
  it("flags leads due within a week and skips converted or disqualified ones", () => {
    const tko_soon = tko_lead({ nextFollowUpAt: new Date(Date.now() + 3 * 86_400_000) });
    const tko_far = tko_lead({ nextFollowUpAt: new Date(Date.now() + 30 * 86_400_000) });
    const tko_converted = tko_lead({ status: "converted", nextFollowUpAt: new Date(Date.now() - 86_400_000) });
    expect(tko_leadFollowUpDue(tko_soon)).toBe(true);
    expect(tko_leadFollowUpDue(tko_far)).toBe(false);
    expect(tko_leadFollowUpDue(tko_converted)).toBe(false);
    expect(tko_leadFollowUpDue(tko_lead({ nextFollowUpAt: null }))).toBe(false);
  });
});

describe("tko_filterDeals", () => {
  const tko_base: TkoCrmDeal = { id: "deal-1", companyId: "company-1", pipelineId: "pipe-1", stageId: "stage-1", name: "Alpha rollout", amountCents: 2_400_000, currency: "USD", probability: 40, ownerMemberId: "member-a", expectedCloseDate: new Date(Date.now() + 10 * 86_400_000), source: "", nextStep: "", wonAt: null, lostAt: null, lossReason: "", updatedAt: new Date("2026-09-01T00:00:00.000Z") };
  const tko_deals = [
    tko_base,
    { ...tko_base, id: "deal-2", name: "Beta migration", ownerMemberId: "member-b", companyId: null, expectedCloseDate: null },
    { ...tko_base, id: "deal-3", name: "Gamma pilot", companyId: "company-2", expectedCloseDate: new Date(Date.now() - 30 * 86_400_000) },
  ];

  it("filters by owner, company and close window", () => {
    expect(tko_filterDeals(tko_deals, { ownerMemberId: "member-b", companyId: "", closeWindow: "all" }).map(tko_deal => tko_deal.id)).toEqual(["deal-2"]);
    expect(tko_filterDeals(tko_deals, { ownerMemberId: "", companyId: "company-2", closeWindow: "all" }).map(tko_deal => tko_deal.id)).toEqual(["deal-3"]);
    expect(tko_filterDeals(tko_deals, { ownerMemberId: "", companyId: "", closeWindow: "overdue" }).map(tko_deal => tko_deal.id)).toEqual(["deal-3"]);
    expect(tko_filterDeals(tko_deals, { ownerMemberId: "", companyId: "", closeWindow: "all" })).toHaveLength(3);
  });
});

describe("TkoCrmLeadTable and status chips", () => {
  const tko_members = [{ id: "member-a", displayName: "Alex Chen" }];
  it("renders lead rows with status, owner and empty state", () => {
    const tko_markup = renderToStaticMarkup(createElement(TkoCrmLeadTable, { tko_leads: [tko_lead()], tko_members, tko_onOpen: () => undefined }));
    expect(tko_markup).toContain("Avery Nguyen");
    expect(tko_markup).toContain("Northstar Labs");
    expect(tko_markup).toContain("Qualified");
    expect(tko_markup).toContain("Alex Chen");
    expect(renderToStaticMarkup(createElement(TkoCrmLeadTable, { tko_leads: [], tko_members, tko_onOpen: () => undefined }))).toContain("No leads match the current filters.");
  });

  it("renders status chips with counts and active state", () => {
    const tko_markup = renderToStaticMarkup(createElement(TkoCrmLeadStatusChips, { tko_value: "qualified", tko_counts: { all: 3, qualified: 2, new: 1 }, tko_onChange: () => undefined }));
    expect(tko_markup).toContain("All");
    expect(tko_markup).toContain("Qualified");
    expect(tko_markup).toContain("2");
  });
});

describe("TkoCrmTimeline", () => {
  it("renders activities and an empty state", () => {
    const tko_markup = renderToStaticMarkup(createElement(TkoCrmTimeline, { tko_activities: [{ id: "a-1", entityType: "lead", entityId: "lead-1", activityType: "status_change", subject: "Status changed to qualified", body: "", createdByMemberId: "member-a", createdAt: new Date("2026-09-02T00:00:00.000Z") }] }));
    expect(tko_markup).toContain("Status changed to qualified");
    expect(tko_markup).toContain("status change");
    expect(renderToStaticMarkup(createElement(TkoCrmTimeline, { tko_activities: [] }))).toContain("No activity recorded yet.");
  });
});

describe("TkoCrmWonLostDialog", () => {
  function tko_render(tko_props: Partial<ComponentProps<typeof TkoCrmWonLostDialog>>) {
    const tko_base: ComponentProps<typeof TkoCrmWonLostDialog> = { tko_stageName: "Lost", tko_category: "lost", tko_pending: false, tko_onConfirm: () => undefined, tko_onClose: () => undefined };
    return renderToStaticMarkup(createElement(TkoCrmWonLostDialog, { ...tko_base, ...tko_props }));
  }

  it("requires a loss reason when closing as lost", () => {
    const tko_markup = tko_render({});
    expect(tko_markup).toContain("Move to Lost?");
    expect(tko_markup).toContain("A loss reason is required");
    expect(tko_markup).toContain("Loss reason");
  });

  it("offers an optional next-step note when closing as won", () => {
    const tko_markup = tko_render({ tko_stageName: "Closed won", tko_category: "won" });
    expect(tko_markup).toContain("Move to Closed won?");
    expect(tko_markup).toContain("Closing as won");
    expect(tko_markup).toContain("Next step note (optional)");
  });
});
