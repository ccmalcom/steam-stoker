import { getDb } from "../db";
import { getSetting } from "../settings";
import { currentProfile, regenerateProfile } from "../profile/store";
import { loadLibraryWithMeta } from "../library";
import { scoreBacklog } from "./stage1";
import { discoverCandidates } from "./discovery";
import { rerank, fallbackRank, type RecMode, type RecItem, type UnifiedCandidate } from "./rerank";

export interface RecRun {
  id: number; created_at: number; mode: RecMode; mood_prompt: string | null;
  items: RecItem[]; degraded: boolean; staleWarning: boolean; rerankFailed: boolean;
}

export async function runRecommendation(mode: RecMode, mood?: string): Promise<RecRun> {
  const anthropicKey = await getSetting("anthropic_api_key");
  const rawgKey = await getSetting("rawg_api_key");
  const model = (await getSetting("anthropic_model")) ?? undefined;
  const thresholdHours = Number((await getSetting("playtime_threshold_hours")) ?? "2");

  const profile = (await currentProfile()) ?? (await regenerateProfile("manual"));
  const library = await loadLibraryWithMeta();

  const unified: UnifiedCandidate[] = [];
  if (mode !== "discovery") {
    for (const c of scoreBacklog(library, profile.profile_json, { playtimeThresholdHours: thresholdHours }))
      unified.push({ title: c.game.title, origin: "backlog", steam_appid: c.game.steam_appid,
                     game_id: c.game.id, installed: !!c.game.installed, priceCents: null,
                     genres: c.genres, tags: c.tags, stage1Reasons: c.reasons });
  }
  let staleWarning = false;
  if (mode !== "backlog") {
    if (!anthropicKey) throw new Error("Discovery requires an Anthropic API key (Settings).");
    const d = await discoverCandidates({
      anthropicKey, rawgKey: rawgKey || null, profileText: profile.profile_text,
      ownedTitles: library.map(x => x.game.title), mood, model,
    });
    staleWarning = d.staleWarning;
    for (const c of d.candidates)
      unified.push({ title: c.title, origin: "discovery", steam_appid: c.steam_appid, game_id: null,
                     installed: false, priceCents: c.priceCents, genres: c.genres, tags: c.tags,
                     stage1Reasons: [c.reason] });
  }

  let degraded = !anthropicKey;
  let rerankFailed = false;
  let items: RecItem[];
  if (degraded) {
    items = fallbackRank(unified);
  } else {
    try {
      items = await rerank({ apiKey: anthropicKey!, profileText: profile.profile_text, mood, candidates: unified, model });
    } catch (e) {
      console.error("rerank failed, falling back to heuristic ranking:", e);
      items = fallbackRank(unified);
      degraded = true;
      rerankFailed = true;
    }
  }

  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = await db.execute(
    "INSERT INTO recommendations (created_at, mode, mood_prompt, results_json) VALUES ($1,$2,$3,$4)",
    [now, mode, mood ?? null, JSON.stringify(items)]);
  return { id: res.lastInsertId as number, created_at: now, mode, mood_prompt: mood ?? null, items, degraded, staleWarning, rerankFailed };
}

export async function recordFeedback(
  recId: number, title: string,
  feedback: "launched" | "dismissed_not_interested" | "dismissed_wont_run"
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ feedback_json: string }[]>(
    "SELECT feedback_json FROM recommendations WHERE id = $1", [recId]);
  if (!rows.length) return;
  const fb = JSON.parse(rows[0].feedback_json) as Record<string, string>;
  fb[title] = feedback;
  await db.execute("UPDATE recommendations SET feedback_json = $1 WHERE id = $2", [JSON.stringify(fb), recId]);
}

export async function latestRuns(limit = 10): Promise<RecRun[]> {
  const db = await getDb();
  const rows = await db.select<any[]>(
    "SELECT * FROM recommendations ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map(r => ({ id: r.id, created_at: r.created_at, mode: r.mode, mood_prompt: r.mood_prompt,
    items: JSON.parse(r.results_json), degraded: false, staleWarning: false, rerankFailed: false }));
}
