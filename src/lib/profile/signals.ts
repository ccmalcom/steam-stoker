import type { Game } from "../types";

export interface GameWithMeta { game: Game; genres: string[]; tags: string[]; }
export interface RecFeedbackSignal { title: string; feedback: "launched" | "dismissed_not_interested"; }
export interface TasteSignals {
  notes: string;
  loved: GameWithMeta[];
  avoided: GameWithMeta[];
  highPlaytimeUnrated: GameWithMeta[];
  recFeedback: RecFeedbackSignal[];
}

export function extractSignals(
  library: GameWithMeta[], notes: string, recFeedback: RecFeedbackSignal[],
  opts: { minHours?: number; maxImplicit?: number } = {}
): TasteSignals {
  const { minHours = 5, maxImplicit = 15 } = opts;
  // wont_run is technically-broken, not disliked: fully neutral (spec locked decision #8).
  const eligible = library.filter(x => x.game.status !== "wont_run");
  const loved = eligible.filter(x => (x.game.user_rating ?? 0) >= 4);
  const avoided = eligible.filter(x => x.game.user_rating !== null && x.game.user_rating <= 2);
  const highPlaytimeUnrated = eligible
    .filter(x => x.game.user_rating === null && x.game.playtime_minutes >= minHours * 60)
    .sort((a, b) => b.game.playtime_minutes - a.game.playtime_minutes)
    .slice(0, maxImplicit);
  return { notes, loved, avoided, highPlaytimeUnrated, recFeedback };
}
