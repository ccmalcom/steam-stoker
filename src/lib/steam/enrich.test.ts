import { describe, it, expect } from "vitest";
import { parseAppDetails } from "./enrich";

const BODY = {
  "570": {
    success: true,
    data: {
      short_description: "Every day, millions battle.",
      header_image: "https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg",
      genres: [{ id: "1", description: "Action" }, { id: "2", description: "Strategy" }],
      categories: [{ id: 1, description: "Multi-player" }, { id: 2, description: "Co-op" }],
      release_date: { coming_soon: false, date: "9 Jul, 2013" },
      metacritic: { score: 90 },
    },
  },
};

describe("parseAppDetails", () => {
  it("maps genres, categories-as-tags, description, image, release, metacritic", () => {
    const d = parseAppDetails(570, BODY)!;
    expect(d.genres).toEqual(["Action", "Strategy"]);
    expect(d.tags).toEqual(["Multi-player", "Co-op"]);
    expect(d.description).toBe("Every day, millions battle.");
    expect(d.metacritic).toBe(90);
    expect(d.release_date).toBe("9 Jul, 2013");
  });
  it("returns null when success is false (delisted app)", () => {
    expect(parseAppDetails(1, { "1": { success: false } })).toBeNull();
  });
  it("tolerates missing optional fields", () => {
    const d = parseAppDetails(2, { "2": { success: true, data: { genres: [] } } })!;
    expect(d).toMatchObject({ genres: [], tags: [], description: null, metacritic: null });
  });
});
