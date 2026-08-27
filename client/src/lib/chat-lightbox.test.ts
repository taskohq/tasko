import { describe, expect, it } from "vitest";
import { tko_galleryIndex } from "./chat-lightbox";

describe("chat lightbox gallery", () => {
  it("moves within image boundaries without wrapping beyond the first or last image", () => {
    expect(tko_galleryIndex(1, 3, -1)).toBe(0);
    expect(tko_galleryIndex(1, 3, 1)).toBe(2);
    expect(tko_galleryIndex(0, 3, -1)).toBe(0);
    expect(tko_galleryIndex(2, 3, 1)).toBe(2);
  });
});
