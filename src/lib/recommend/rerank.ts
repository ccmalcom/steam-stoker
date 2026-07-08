import { claudeComplete, extractJson } from "../anthropic";
import { normalizeTitle } from "./resolve";
import type { FetchFn } from "../steam/webapi";

export type RecMode = "backlog" | "mixed" | "discovery";
export interface RecItem {
  title: string; why: string; origin: "backlog" | "discovery";
  steam_appid: number | null; game_id: number | null; installed: boolean; priceCents: number | null;
}
export interface UnifiedCandidate {
  title: string; origin: "backlog" | "discovery"; steam_appid: number | null; game_id: number | null;
  installed: boolean; priceCents: number | null; genres: string[]; tags: string[]; stage1Reasons: string[];
}

const SYSTEM = `You are the final ranking stage of a personal game recommender.
You will receive the player's taste profile, an optional mood, and a list of CANDIDATES.
Rank ONLY games from the candidate list — never introduce new titles.
Respond with ONLY a JSON array, best first: [{"title": "<exact candidate title>", "why": "1-2 sentences, personal, tied to their profile/mood"}].`;

export async function rerank(opts: {
  apiKey: string; profileText: string; mood?: string;
  candidates: UnifiedCandidate[]; topN?: number; model?: string; fetchFn?: FetchFn;
}): Promise<RecItem[]> {
  const { apiKey, profileText, mood, candidates, topN = 8, model, fetchFn } = opts;
  const user = [
    `TASTE PROFILE:\n${profileText}`,
    mood ? `\nMOOD RIGHT NOW: ${mood}` : "",
    `\nCANDIDATES:\n${JSON.stringify(candidates.map(c => ({
      title: c.title, origin: c.origin, installed: c.installed,
      genres: c.genres, tags: c.tags, signals: c.stage1Reasons,
      price: c.priceCents !== null ? `$${(c.priceCents / 100).toFixed(2)}` : undefined,
    })), null, 1)}`,
    `\nReturn the best ${topN}.`,
  ].join("\n");

  const raw = await claudeComplete({ apiKey, system: SYSTEM, user, model, fetchFn });
  const ranked = extractJson<{ title: string; why: string }[]>(raw);
  const byTitle = new Map(candidates.map(c => [normalizeTitle(c.title), c]));
  const items: RecItem[] = [];
  for (const r of ranked) {
    const c = byTitle.get(normalizeTitle(r.title));
    if (!c) continue; // anti-hallucination: only candidates survive
    items.push({ title: c.title, why: r.why, origin: c.origin, steam_appid: c.steam_appid,
                 game_id: c.game_id, installed: c.installed, priceCents: c.priceCents });
    if (items.length >= topN) break;
  }
  return items;
}

export function fallbackRank(candidates: UnifiedCandidate[], topN = 8): RecItem[] {
  return candidates.slice(0, topN).map(c => ({
    title: c.title, why: c.stage1Reasons.join("; ") || "matches your library profile",
    origin: c.origin, steam_appid: c.steam_appid, game_id: c.game_id,
    installed: c.installed, priceCents: c.priceCents,
  }));
}
