import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVdf, parseAppManifest, parseLibraryFolders } from "./acf";

const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");

describe("parseVdf", () => {
  it("parses nested keyvalues", () => {
    const o = parseVdf(fx("appmanifest_570.acf")) as any;
    expect(o.AppState.appid).toBe("570");
    expect(o.AppState.name).toBe("Dota 2");
  });
  it("returns {} for garbage input", () => {
    expect(parseVdf("not vdf at all")).toEqual({});
  });
});

describe("parseAppManifest", () => {
  it("extracts appid, name, size", () => {
    expect(parseAppManifest(fx("appmanifest_570.acf"))).toEqual({
      appid: 570, name: "Dota 2", sizeOnDisk: 39098080858,
    });
  });
  it("returns null when fields are missing", () => {
    expect(parseAppManifest('"AppState" { "foo" "bar" }')).toBeNull();
  });
});

describe("parseLibraryFolders", () => {
  it("extracts all library paths", () => {
    expect(parseLibraryFolders(fx("libraryfolders.vdf"))).toEqual([
      "C:\\Program Files (x86)\\Steam",
      "D:\\games",
    ]);
  });
});
