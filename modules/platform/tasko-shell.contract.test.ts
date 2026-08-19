import { describe, expect, it } from "vitest";
import { tko_moduleForPath, tko_shellModules } from "../../client/src/components/TaskoShell";

describe("TaskoShell navigation contracts", () => {
  it("resolves every primary module and keeps unknown paths on operations overview", () => {
    expect(tko_moduleForPath("/")).toBe("work");
    expect(tko_moduleForPath("/work")).toBe("work");
    expect(tko_moduleForPath("/chat#mentions")).toBe("chat");
    expect(tko_moduleForPath("/crm")).toBe("crm");
    expect(tko_moduleForPath("/ai")).toBe("ai");
    expect(tko_moduleForPath("/platform")).toBe("overview");
    expect(tko_moduleForPath("/unmatched")).toBe("overview");
  });

  it("publishes non-empty contextual navigation for each module", () => {
    expect(Object.keys(tko_shellModules).sort()).toEqual(["ai", "chat", "crm", "overview", "work"]);
    for (const tko_module of Object.values(tko_shellModules)) {
      expect(tko_module.nav.length).toBeGreaterThan(0);
      expect(tko_module.nav.every(tko_item => tko_item.path.startsWith("/"))).toBe(true);
      expect(tko_module.nav.every(tko_item => tko_item.label.length > 0)).toBe(true);
    }
  });
});
