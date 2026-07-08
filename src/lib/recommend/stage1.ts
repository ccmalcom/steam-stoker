import type { Game } from "../types";
import type { GameWithMeta } from "../profile/signals";
import type { ProfileJson, WeightedName } from "../profile/generate";

export interface Candidate { game: Game; genres: string[]; tags: string[]; score: number; reasons: string[]; }
export interface Stage1Opts {
  playtimeThresholdHours?: number; installedBoost?: number; genreWeight?: number;
  tagWeight?: number; avoidPenalty?: number; varietyWeight?: number; topN?: number;
}

function matchScore(names: string[], weighted: WeightedName[]): { score: number; hits: string[] } {
  const total = weighted.reduce((s, w) => s + w.weight, 0) || 1;
  let score = 0; const hits: string[] = [];
  for (const w of weighted) if (names.includes(w.name)) { score += w.weight / total; hits.push(w.name); }
  return { score, hits };
}

export function scoreBacklog(library: GameWithMeta[], profile: ProfileJson, opts: Stage1Opts = {}): Candidate[] {
  const {
    playtimeThresholdHours = 2, installedBoost = 1.5, genreWeight = 3,
    tagWeight = 2, avoidPenalty = 2.5, varietyWeight = 1, topN = 20,
  } = opts;

  // Variety baseline: tags of the most recently played game.
  const recent = [...library].sort((a, b) => (b.game.last_played_at ?? 0) - (a.game.last_played_at ?? 0))[0];
  const recentTags = new Set(recent?.tags ?? []);

  const eligible = library.filter(x =>
    x.game.status === "active" && x.game.playtime_minutes < playtimeThresholdHours * 60);

  const scored: Candidate[] = eligible.map(x => {
    const reasons: string[] = [];
    const lg = matchScore(x.genres, profile.loved_genres);
    const lt = matchScore(x.tags, profile.loved_tags);
    const ag = matchScore(x.genres, profile.avoided_genres);
    const at = matchScore(x.tags, profile.avoided_tags);
    let score = genreWeight * lg.score + tagWeight * lt.score - avoidPenalty * (ag.score + at.score);
    if (lg.hits.length) reasons.push(`matches loved genres: ${lg.hits.join(", ")}`);
    if (lt.hits.length) reasons.push(`matches loved tags: ${lt.hits.slice(0, 4).join(", ")}`);
    if (ag.hits.length || at.hits.length) reasons.push(`⚠ overlaps avoids: ${[...ag.hits, ...at.hits].join(", ")}`);
    if (x.game.installed) { score += installedBoost; reasons.push("already installed"); }
    if (recentTags.size) {
      const overlap = x.tags.filter(t => recentTags.has(t)).length;
      const variety = 1 - overlap / Math.max(recentTags.size, 1);
      score += varietyWeight * variety;
      if (variety > 0.8 && x.tags.length) reasons.push("a change of pace from your last game");
    }
    return { game: x.game, genres: x.genres, tags: x.tags, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}
