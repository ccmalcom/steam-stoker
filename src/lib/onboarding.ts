import { getDb } from "./db";
import { getSetting, setSetting } from "./settings";
import type { Game } from "./types";

export type WizardStep = "welcome" | "steam_key" | "steam_id" | "folders" | "sync" | "sprint" | "bounced" | "done";
export const STEP_ORDER: WizardStep[] = ["welcome", "steam_key", "steam_id", "folders", "sync", "sprint", "bounced", "done"];

export function nextStep(current: WizardStep): WizardStep {
  const i = STEP_ORDER.indexOf(current);
  return STEP_ORDER[Math.min(i + 1, STEP_ORDER.length - 1)];
}

export async function isOnboardingComplete(): Promise<boolean> {
  return (await getSetting("onboarding_complete")) === "1";
}
export async function completeOnboarding(): Promise<void> { await setSetting("onboarding_complete", "1"); }

export async function sprintGames(limit = 20): Promise<Game[]> {
  const db = await getDb();
  return db.select<Game[]>(
    `SELECT * FROM games WHERE user_rating IS NULL AND status = 'active'
     ORDER BY playtime_minutes DESC LIMIT $1`, [limit]);
}
