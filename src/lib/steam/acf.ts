// Valve KeyValues (VDF) text format: quoted keys, quoted values or nested { } blocks.
type VdfObject = Record<string, unknown>;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[1] !== undefined ? m[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"') : m[2]);
  }
  return tokens;
}

export function parseVdf(text: string): VdfObject {
  const tokens = tokenize(text);
  let i = 0;
  function parseBlock(): VdfObject {
    const obj: VdfObject = {};
    while (i < tokens.length) {
      const tok = tokens[i++];
      if (tok === "}") return obj;
      if (tok === "{") continue; // stray brace; skip defensively
      const next = tokens[i];
      if (next === "{") { i++; obj[tok] = parseBlock(); }
      else if (next !== undefined && next !== "}") { i++; obj[tok] = next; }
    }
    return obj;
  }
  return parseBlock();
}

export interface InstalledApp { appid: number; name: string; sizeOnDisk: number; }

export function parseAppManifest(text: string): InstalledApp | null {
  const o = parseVdf(text) as any;
  const s = o?.AppState;
  if (!s?.appid || !s?.name) return null;
  return {
    appid: Number(s.appid),
    name: String(s.name),
    sizeOnDisk: Number(s.SizeOnDisk ?? 0),
  };
}

export function parseLibraryFolders(text: string): string[] {
  const o = parseVdf(text) as any;
  const root = o?.libraryfolders;
  if (!root) return [];
  const paths: string[] = [];
  for (const key of Object.keys(root)) {
    const entry = root[key];
    if (entry && typeof entry === "object" && typeof entry.path === "string") paths.push(entry.path);
  }
  return paths;
}
