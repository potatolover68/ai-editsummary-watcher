// Vendored from ai-editsummary-heuristics@6dbcf67 (src/index.ts). Edit there and re-copy.
import {
  ANTI_SIGNS,
  AUTOCOMMENT,
  SIGNS,
  type AntiRule,
  type AntiTier,
  type Rule,
  type Tier,
} from "./rules.ts";

export { ANTI_SIGNS, COLOR_TIER, SIGNS, countPolicyNods } from "./rules.ts";
export type { AntiRule, AntiTier, Color, Rule, Tier } from "./rules.ts";

/**
 * - "ai":        obviously AI; skip the model
 * - "human":     obviously not AI (human, tool or software generated); skip the model
 * - "uncertain": send to the model
 */
export type Verdict = "ai" | "human" | "uncertain";

export interface Match {
  id: string;
  tier: Tier | AntiTier;
  kind: "sign" | "anti-sign";
  description: string;
}

export interface Result {
  verdict: Verdict;
  /** Sum of sign weights minus anti-sign weights (giveaway/definitive are ±Infinity). */
  score: number;
  matches: Match[];
}

export interface Options {
  /** Score at or above which the verdict is "ai". Default 5. */
  aiThreshold?: number;
  /** Score at or below which the verdict is "human". Default -2. */
  humanThreshold?: number;
}

export const SIGN_WEIGHTS: Record<Tier, number> = {
  giveaway: Infinity,
  strong: 3,
  moderate: 1.5,
  weak: 0.5,
};

export const ANTI_WEIGHTS: Record<AntiTier, number> = {
  definitive: Infinity,
  strong: 3,
  moderate: 1.5,
  weak: 0.5,
};

function run(rule: Rule, body: string): boolean {
  return typeof rule.test === "function" ? rule.test(body) : rule.test.test(body);
}

function runAnti(rule: AntiRule, raw: string, body: string): boolean {
  return typeof rule.test === "function" ? rule.test(raw, body) : rule.test.test(raw);
}

/** Strip the auto-generated "/* Section *\/" prefix MediaWiki adds. */
export function stripAutocomment(summary: string): string {
  return summary.replace(AUTOCOMMENT, "");
}

export function analyze(summary: string, options: Options = {}): Result {
  const aiThreshold = options.aiThreshold ?? 5;
  const humanThreshold = options.humanThreshold ?? -2;
  const raw = summary ?? "";
  const body = stripAutocomment(raw);
  const matches: Match[] = [];
  let pos = 0;
  let neg = 0;
  let giveaway = false;
  let definitive = false;

  // Overlapping rules share a group; only the strongest match per group counts.
  const groupBest = new Map<string, number>();
  for (const rule of SIGNS) {
    if (!run(rule, body)) continue;
    matches.push({ id: rule.id, tier: rule.tier, kind: "sign", description: rule.description });
    if (rule.tier === "giveaway") giveaway = true;
    else if (rule.group) groupBest.set(rule.group, Math.max(groupBest.get(rule.group) ?? 0, SIGN_WEIGHTS[rule.tier]));
    else pos += SIGN_WEIGHTS[rule.tier];
  }
  for (const w of groupBest.values()) pos += w;
  for (const rule of ANTI_SIGNS) {
    if (!runAnti(rule, raw, body)) continue;
    matches.push({ id: rule.id, tier: rule.tier, kind: "anti-sign", description: rule.description });
    if (rule.tier === "definitive") definitive = true;
    else neg += ANTI_WEIGHTS[rule.tier];
  }

  let verdict: Verdict;
  let score: number;
  if (giveaway && definitive) {
    verdict = "uncertain";
    score = 0;
  } else if (giveaway) {
    verdict = "ai";
    score = Infinity;
  } else if (definitive) {
    verdict = "human";
    score = -Infinity;
  } else {
    score = pos - neg;
    // No AI signs at all plus a moderate-or-stronger anti-sign: human.
    if (pos === 0 && neg >= ANTI_WEIGHTS.moderate) verdict = "human";
    else if (score >= aiThreshold) verdict = "ai";
    else if (score <= humanThreshold) verdict = "human";
    else verdict = "uncertain";
  }
  return { verdict, score, matches };
}

/** Convenience: just the verdict. */
export function triage(summary: string, options?: Options): Verdict {
  return analyze(summary, options).verdict;
}
