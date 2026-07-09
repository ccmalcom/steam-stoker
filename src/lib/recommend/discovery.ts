import { claudeComplete, extractJson, type ClaudeTool } from "../anthropic";
import { rawgSearch, rawgByGenre } from "./rawg";
import * as resolveModule from "./resolve";
import type { FetchFn } from "../steam/webapi";

export interface DiscoveryCandidate {
  title: string; reason: string;
  steam_appid: number | null; priceCents: number | null;
  genres: string[]; tags: string[];
}

const TOOLS: ClaudeTool[] = [
  {
    name: "search_games",
    description: "Search the RAWG game catalog by title or keywords. Use to verify a game exists and check its release date, genres and reception.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "games_by_genre",
    description: "List recent/popular RAWG games filtered by genre slugs (e.g. 'role-playing-games-rpg', 'indie', 'strategy'). Use to find recent releases matching the player's taste.",
    input_schema: {
      type: "object",
      properties: {
        genres: { type: "array", items: { type: "string" } },
        from_date: { type: "string", description: "YYYY-MM-DD" },
        to_date: { type: "string", description: "YYYY-MM-DD" },
        ordering: { type: "string", description: "-added | -released | -metacritic" },
      },
    },
  },
];

const SYSTEM = `You are the discovery engine for a personal game recommender.
Given a player's taste profile, propose games they do NOT already own.
Use the tools to verify titles and find recent releases before answering. Prefer well-received games; include a couple of adventurous picks.
Respond with ONLY a JSON array: [{"title": "...", "reason": "one sentence tied to their profile"}]. No other text.`;

export async function discoverCandidates(opts: {
  anthropicKey: string; rawgKey: string | null;
  profileText: string; ownedTitles: string[]; mood?: string;
  model?: string; fetchFn?: FetchFn; count?: number;
}): Promise<{ candidates: DiscoveryCandidate[]; staleWarning: boolean }> {
  const { anthropicKey, rawgKey, profileText, ownedTitles, mood, model, fetchFn, count = 20 } = opts;

  const user = [
    `TASTE PROFILE:\n${profileText}`,
    mood ? `\nMOOD RIGHT NOW: ${mood}` : "",
    `\nALREADY OWNED (do not propose these):\n${ownedTitles.join("; ")}`,
    `\nPropose ${count} games.`,
  ].join("\n");

  const raw = await claudeComplete({
    apiKey: anthropicKey, system: SYSTEM, user, model, fetchFn,
    ...(rawgKey ? {
      tools: TOOLS,
      handlers: {
        search_games: (inp: any) => rawgSearch(rawgKey, inp.query, fetchFn),
        games_by_genre: (inp: any) => rawgByGenre(rawgKey, {
          genres: inp.genres, fromDate: inp.from_date, toDate: inp.to_date, ordering: inp.ordering,
        }, fetchFn),
      },
    } : {}),
  });

  const proposed = extractJson<{ title: string; reason: string }[]>(raw);
  const ownedNorm = new Set(ownedTitles.map(resolveModule.normalizeTitle));
  const candidates: DiscoveryCandidate[] = [];

  for (const p of proposed) {
    if (ownedNorm.has(resolveModule.normalizeTitle(p.title))) continue;
    const hit = await resolveModule.resolveSteamApp(p.title, fetchFn);
    if (hit && ownedNorm.has(resolveModule.normalizeTitle(hit.name))) continue;
    candidates.push({
      title: hit?.name ?? p.title, reason: p.reason,
      steam_appid: hit?.appid ?? null, priceCents: hit?.priceCents ?? null,
      genres: [], tags: [],
    });
  }
  return { candidates, staleWarning: rawgKey === null };
}
