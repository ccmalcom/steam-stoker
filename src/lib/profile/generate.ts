import type { TasteSignals, GameWithMeta } from "./signals";

export interface WeightedName { name: string; weight: number; }
export interface ProfileJson {
  loved_genres: WeightedName[]; loved_tags: WeightedName[];
  avoided_genres: WeightedName[]; avoided_tags: WeightedName[];
  loved_games: { title: string; why: string }[];
  avoided_games: { title: string; why: string }[];
  notes: string;
}

const EXPLICIT_WEIGHT = 3, IMPLICIT_WEIGHT = 1;

function tally(items: { source: GameWithMeta; weight: number }[], pick: (x: GameWithMeta) => string[]): WeightedName[] {
  const map = new Map<string, number>();
  for (const { source, weight } of items)
    for (const name of pick(source)) map.set(name, (map.get(name) ?? 0) + weight);
  return [...map.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}

function why(x: GameWithMeta): string {
  if (x.game.user_rating) return `rated ${x.game.user_rating}★`;
  return `${Math.round(x.game.playtime_minutes / 60)}h played`;
}

export function buildProfile(signals: TasteSignals): { profile_json: ProfileJson; profile_text: string } {
  const lovedSources = [
    ...signals.loved.map(s => ({ source: s, weight: EXPLICIT_WEIGHT })),
    ...signals.highPlaytimeUnrated.map(s => ({ source: s, weight: IMPLICIT_WEIGHT })),
  ];
  const avoidedSources = signals.avoided.map(s => ({ source: s, weight: EXPLICIT_WEIGHT }));

  const profile_json: ProfileJson = {
    loved_genres: tally(lovedSources, x => x.genres),
    loved_tags: tally(lovedSources, x => x.tags),
    avoided_genres: tally(avoidedSources, x => x.genres),
    avoided_tags: tally(avoidedSources, x => x.tags),
    loved_games: [...signals.loved, ...signals.highPlaytimeUnrated].map(x => ({ title: x.game.title, why: why(x) })),
    avoided_games: signals.avoided.map(x => ({ title: x.game.title, why: why(x) })),
    notes: signals.notes,
  };

  const fmt = (w: WeightedName[], n = 10) => w.slice(0, n).map(x => `${x.name} (${x.weight})`).join(", ") || "none yet";
  const games = (g: { title: string; why: string }[]) => g.map(x => `- ${x.title} — ${x.why}`).join("\n") || "- none yet";

  const profile_text = [
    signals.notes ? `PLAYER'S OWN WORDS (highest priority):\n${signals.notes}\n` : "",
    `LOVED GAMES:\n${games(profile_json.loved_games)}`,
    `\nLOVED GENRES: ${fmt(profile_json.loved_genres)}`,
    `LOVED TAGS: ${fmt(profile_json.loved_tags, 15)}`,
    `\nAVOID — GAMES:\n${games(profile_json.avoided_games)}`,
    `AVOID — GENRES: ${fmt(profile_json.avoided_genres)}`,
    `AVOID — TAGS: ${fmt(profile_json.avoided_tags)}`,
    signals.recFeedback.length
      ? `\nRECENT REC FEEDBACK (light signal):\n${signals.recFeedback.map(f => `- ${f.title}: ${f.feedback}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  return { profile_json, profile_text };
}
