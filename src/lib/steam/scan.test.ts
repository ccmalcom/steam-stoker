import { describe, it, expect } from "vitest";
import { discoverLibraryPaths, scanInstalled, type FsAdapter } from "./scan";

function fakeFs(files: Record<string, string>, dirs: Record<string, string[]>): FsAdapter {
  return {
    readTextFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    readDir: async (p) => (dirs[p] ?? []).map((name) => ({ name })),
    exists: async (p) => p in files || p in dirs,
  };
}

const LIBVDF = `"libraryfolders" { "0" { "path" "C:\\\\games" } "1" { "path" "D:\\\\games" } }`;
const ACF = (id: number, name: string) =>
  `"AppState" { "appid" "${id}" "name" "${name}" "SizeOnDisk" "1000" }`;

describe("discoverLibraryPaths", () => {
  it("reads libraryfolders.vdf under the steam root", async () => {
    const fs = fakeFs({ "C:\\Steam\\steamapps\\libraryfolders.vdf": LIBVDF }, {});
    expect(await discoverLibraryPaths(fs, "C:\\Steam")).toEqual(["C:\\games", "D:\\games"]);
  });
  it("returns [] when the file is missing", async () => {
    expect(await discoverLibraryPaths(fakeFs({}, {}), "C:\\Steam")).toEqual([]);
  });
});

describe("scanInstalled", () => {
  it("parses every appmanifest in every library's steamapps", async () => {
    const fs = fakeFs(
      {
        "C:\\games\\steamapps\\appmanifest_570.acf": ACF(570, "Dota 2"),
        "D:\\games\\steamapps\\appmanifest_1086940.acf": ACF(1086940, "Baldur's Gate 3"),
      },
      {
        "C:\\games\\steamapps": ["appmanifest_570.acf", "workshop"],
        "D:\\games\\steamapps": ["appmanifest_1086940.acf"],
      }
    );
    const apps = await scanInstalled(fs, ["C:\\games", "D:\\games"]);
    expect(apps.map((a) => a.appid).sort((a, b) => a - b)).toEqual([570, 1086940]);
  });
  it("skips unreadable/corrupt manifests without throwing", async () => {
    const fs = fakeFs(
      { "C:\\games\\steamapps\\appmanifest_1.acf": "garbage" },
      { "C:\\games\\steamapps": ["appmanifest_1.acf", "appmanifest_2.acf"] } // _2 unreadable
    );
    expect(await scanInstalled(fs, ["C:\\games"])).toEqual([]);
  });
});
