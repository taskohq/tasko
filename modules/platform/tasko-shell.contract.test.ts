import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tko_brandAssets, tko_moduleForPath, tko_shellModules } from "../../client/src/components/TaskoShell";

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

  it("uses the official immutable logo and favicon assets across shell metadata", () => {
    expect(tko_brandAssets.logo).toBe("/manus-storage/tasko-logo_50726dd1.png");
    expect(tko_brandAssets.favicon).toBe("/manus-storage/tasko-favicon_2220cdac.png");

    const tko_indexHtml = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    expect(tko_indexHtml).toContain(`href="${tko_brandAssets.favicon}"`);
    expect(tko_indexHtml).toContain('name="application-name" content="Tasko"');
  });
});
