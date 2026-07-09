import { getDb } from "../db";
import { getSetting } from "../settings";
import { loadLibraryWithMeta } from "../library";
import { extractSignals, type RecFeedbackSignal } from "./signals";
import { buildProfile, type ProfileJson } from "./generate";

export type ProfileTrigger = "sync" | "rating_change" | "manual";
export interface StoredProfile {
  id: number; generated_at: number; profile_json: ProfileJson;
  profile_text: string; trigger_reason: ProfileTrigger;
}

export async function saveProfile(
  p: { profile_json: ProfileJson; profile_text: string }, trigger: ProfileTrigger
): Promise<number> {
  const db = await getDb();
  // No manual BEGIN/COMMIT: @tauri-apps/plugin-sql runs each execute() on a separate
  // pooled connection, so a transaction split across calls fails with "cannot commit -
  // no transaction is active". Run sequentially instead. The brief window where no row
  // is is_current is self-healing — the next regenerate re-establishes exactly one.
  await db.execute("UPDATE taste_profile SET is_current = 0 WHERE is_current = 1");
  const res = await db.execute(
    `INSERT INTO taste_profile (generated_at, profile_json, profile_text, trigger_reason, is_current)
     VALUES ($1,$2,$3,$4,1)`,
    [Math.floor(Date.now() / 1000), JSON.stringify(p.profile_json), p.profile_text, trigger]
  );
  return res.lastInsertId as number;
}

function rowToProfile(r: any): StoredProfile {
  return { id: r.id, generated_at: r.generated_at, profile_json: JSON.parse(r.profile_json),
           profile_text: r.profile_text, trigger_reason: r.trigger_reason };
}

export async function currentProfile(): Promise<StoredProfile | null> {
  const db = await getDb();
  const rows = await db.select<any[]>("SELECT * FROM taste_profile WHERE is_current = 1 LIMIT 1");
  return rows.length ? rowToProfile(rows[0]) : null;
}

export async function profileHistory(): Promise<StoredProfile[]> {
  const db = await getDb();
  return (await db.select<any[]>("SELECT * FROM taste_profile ORDER BY generated_at DESC")).map(rowToProfile);
}

async function loadRecentFeedback(): Promise<RecFeedbackSignal[]> {
  const db = await getDb();
  const recs = await db.select<{ results_json: string; feedback_json: string }[]>(
    "SELECT results_json, feedback_json FROM recommendations ORDER BY created_at DESC LIMIT 10");
  const out: RecFeedbackSignal[] = [];
  for (const rec of recs) {
    const feedback = JSON.parse(rec.feedback_json) as Record<string, string>;
    for (const [title, fb] of Object.entries(feedback))
      if (fb === "launched" || fb === "dismissed_not_interested") out.push({ title, feedback: fb });
  }
  return out;
}

export async function regenerateProfile(trigger: ProfileTrigger): Promise<StoredProfile> {
  const library = await loadLibraryWithMeta();
  const notes = (await getSetting("taste_notes")) ?? "";
  const feedback = await loadRecentFeedback();
  const built = buildProfile(extractSignals(library, notes, feedback));
  const id = await saveProfile(built, trigger);
  return { id, generated_at: Math.floor(Date.now() / 1000), trigger_reason: trigger, ...built };
}
