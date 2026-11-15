// Vendored from ai-editsummary-heuristics@6dbcf67 (src/rules.ts). Edit there and re-copy.
/**
 * Heuristic rules for AI-generated Wikipedia edit summaries.
 *
 * Sources: WP:AISIGNS#Edit summaries (https://en.wikipedia.org/wiki/WP:AISUMMARY)
 * and the tag vocabulary of the "AI edit summaries" dataset (the Tags sheet).
 *
 * Tiers mirror the dataset's colour legend:
 *   giveaway (red)    - decisive on its own
 *   strong   (orange)
 *   moderate (yellow)
 *   weak     (green)
 *
 * Every tier below was checked against ~12k tagged AI summaries and a sample
 * of pre-ChatGPT (pre-2022-11-30) human summaries; run `npm run eval` to
 * regenerate the per-rule hit rates (see README).
 */

export type Tier = "giveaway" | "strong" | "moderate" | "weak";

/** Colour of a dataset tag (the Tags sheet legend). */
export type Color = "Red" | "Orange" | "Yellow" | "Green" | "Blue";

/** Tier each colour maps to before any data-based cap. */
export const COLOR_TIER: Record<Color, Tier> = {
  Red: "giveaway",
  Orange: "strong",
  Yellow: "moderate",
  Green: "weak",
  Blue: "weak",
};

export interface Rule {
  id: string;
  /** Dataset tag(s) this rule approximates, if any. */
  tag?: string;
  /** Colour of that tag in the Tags sheet. */
  color?: Color;
  /** Rules in the same group overlap; only the strongest match in a group counts. */
  group?: string;
  tier: Tier;
  description: string;
  /** A regex, or a function returning true on match. */
  test: RegExp | ((s: string) => boolean);
}

// Shared fragments --------------------------------------------------------

const QUALITY =
  "(?:clarity|readability|flow|concision|conciseness|coherence|cohesion|consistency|neutrality|accuracy|precision|verifiability|tone|structure|organi[sz]ation|presentation|formatting|sourcing|attribution|wording|phrasing|style|scannability|discoverability|navigation|connectivity)";

const POLICY_NOUNS = [
  /\bverifiab(?:le|ility)\b/i,
  /\bneutral(?:ity|ly)?\b/i,
  /\bnotab(?:le|ility)\b/i,
  /\breliable,? (?:\w+ )?(?:sources?|references?|citations?|coverage)\b/i,
  /\bindependent,? (?:\w+ )?(?:sources?|references?|coverage)\b/i,
  /\b(?:secondary|third[- ]party|peer[- ]reviewed)(?:,? \w+)? (?:sources?|references?|coverage|literature)\b/i,
  /\bencyclop(?:a)?edic\b/i,
  /\bpromotional\b/i,
  /\b(?:inline citations?|internal (?:wiki)?links?|wikilinks)\b/i,
  /\bmanual of style\b/i,
  /\bWP:[A-Z]+\b/,
];

/** Count distinct policy/quality nouns ("Itemized policy" / "General policy nods"). */
export function countPolicyNods(s: string): number {
  let n = 0;
  for (const re of POLICY_NOUNS) if (re.test(s)) n++;
  const q = s.match(new RegExp(`\\b${QUALITY}\\b`, "gi"));
  if (q) n += new Set(q.map((x) => x.toLowerCase())).size;
  return n;
}

// Signs (indicate AI) -----------------------------------------------------

export const SIGNS: Rule[] = [
  // --- giveaway --------------------------------------------------------
  {
    id: "chatbot-preamble",
    tag: "User communication",
    color: "Green",
    tier: "giveaway", // narrow chatbot-reply pattern; 0 human hits
    description: 'Chatbot reply preamble ("Sure! Here\'s an edit summary…", "Certainly.")',
    test: /^\W*(?:sure|certainly|absolutely|of course)\b[!,.]|\bhere(?:'|’)?s (?:a |an |the |my |your )?(?:\w+ ){0,3}(?:edit summary|summary|breakdown|version|revised|rewrite)\b|\bclaude responded\b|\bask chatgpt\b|\byou (?:can|could|may) use\b/i,
  },
  {
    id: "summary-label",
    tag: "Saying it's a summary",
    color: "Yellow",
    tier: "giveaway", // narrow pattern; 0 human hits
    description: 'Summary labels itself ("Edit summary:", "Concise edit summary:")',
    test: /^\W*(?:\*\*)?\s*(?:concise |suggested |short |brief |final )?edit summary\s*(?:\*\*)?\s*[:：]/i,
  },
  {
    id: "markdown-bold",
    tag: "Markdown",
    color: "Orange",
    tier: "giveaway", // narrow pattern; 1 human hit in 44.5k
    description: "Markdown bold/headers or code fences",
    test: /\*\*[^*\n]{2,80}\*\*|```|^#{1,3} \w/,
  },
  {
    id: "provided-text",
    tag: "Provided text",
    color: "Red",
    tier: "giveaway",
    description: 'Refers to text given to a chatbot ("the provided paragraph", "the latest screenshot")',
    test: /\bthe provided (?:text|paragraph|content|passage|draft|list|section|sentence|article|information)\b|\b(?:latest|attached|uploaded) (?:screenshots?|image)\b/i,
  },
  {
    id: "second-person-change",
    tag: "User communication",
    color: "Green",
    tier: "weak",
    description: 'Describes the user\'s edit in second person ("you replaced a comma…")',
    test: /\byou (?:replaced|added|removed|changed|made|corrected|rephrased|rewrote|updated|fixed|expanded)\b/i,
  },
  {
    id: "ai-disclosure",
    tag: "It says so",
    color: "Yellow",
    tier: "giveaway", // explicit AI disclosure; 0 human hits
    description: 'Discloses AI use ("AI-assisted", "generated with ChatGPT")',
    test: /\b(?:ai|llm)[- ]assist(?:ed|ance)\b|\b(?:generated|drafted|written|created) (?:with|by|using) (?:the help of )?(?:an? )?(?:ai|llm|chatgpt|gpt|claude|gemini|copilot)\b/i,
  },
  {
    id: "unicode-letter-markup",
    tag: "Unicode letter markup",
    color: "Yellow",
    tier: "giveaway", // narrow artefact; 0 human hits
    description: "Zero-width characters sprinkled inside words (LLM watermark-like artefact)",
    // Needs >= 3 occurrences of at least two different invisible characters;
    // a single kind (e.g. ZWSP between pinyin syllables) is legitimate.
    test: (s) => {
      const hits = s.match(/\p{L}[​-‍⁠﻿]+(?=\p{L})/gu) ?? [];
      const kinds = new Set(s.match(/[​-‍⁠﻿]/g) ?? []);
      return hits.length >= 3 && kinds.size >= 2;
    },
  },
  {
    id: "while-preserving",
    tag: "Preserved X / Retained X / Maintained X",
    color: "Yellow",
    tier: "moderate",
    description: '"…while preserving/retaining/maintaining X"',
    test: /\bwhile (?:preserving|retaining|maintaining|keeping)\b/i,
  },
  {
    id: "without-altering",
    tag: "Without doing X",
    color: "Orange",
    tier: "strong",
    description: '"without altering the meaning/content", "without overstating"',
    test: /\bwithout (?:altering|changing|modifying|affecting|overstating|embellishment|removing (?:any )?(?:sourced|content|information))\b/i,
  },
  {
    id: "afc-reviewer-feedback",
    tag: "AfC references",
    color: "Yellow",
    tier: "moderate",
    description: 'Addresses AfC reviewer feedback ("Addressed reviewer feedback by…")',
    test: /\b(?:address(?:ed|es|ing)?|per|following|in response to|implement(?:ed|ing)?|incorporat(?:ed|ing))\b (?:the |all |prior |previous |recent )?(?:afc |draft )?(?:reviewer|review)(?:'s|s'|s)? (?:feedback|comments|concerns|notes)\b/i,
  },
  {
    id: "wikipedia-guidelines",
    tag: "Mentioning Wikipedia",
    color: "Yellow",
    tier: "moderate",
    description: 'Spells out that edits follow "Wikipedia\'s guidelines/standards"',
    test: /\bwikipedia(?:'|’)?s?(?: \w+)? (?:guidelines?|policies|policy|standards?|style|manual of style|requirements|conventions|norms|neutrality|content)\b|\b(?:for|on) wikipedia\b(?! ?(?:talk|:))/i,
  },
  {
    id: "compliance",
    tag: "Compliance with / Adhering to X / Align with",
    color: "Yellow",
    tier: "moderate",
    description: '"to comply with / adhere to / align with / in line with" guidelines',
    test: /\b(?:in )?complian(?:ce|t) with\b|\bto comply with\b|\badher(?:e|es|ed|ing|ence) to\b|\b(?:better |to |more closely )?align(?:s|ed|ing)? (?:it |the \w+ |them )?with\b|\bin (?:line|keeping) with (?:wikipedia|wp|the|encyclopedic|mos)/i,
  },
  {
    id: "ensure",
    tag: "Ensured X",
    color: "Yellow",
    tier: "moderate",
    description: '"ensure/ensuring" in a summary',
    test: /\bensur(?:e|ed|es|ing)\b/i,
  },
  {
    id: "encyclopedic-tone",
    tag: "Encyclopedic tone",
    color: "Yellow",
    tier: "moderate",
    description: '"encyclopedic tone/style/language"',
    test: /\b(?:more |a |an |neutral,? )?encyclop(?:a)?edic (?:tone|style|language|register|standards?|voice|presentation|format|alternatives?)\b/i,
  },
  {
    id: "quality-for",
    group: "quality",
    tag: "Clarity / Readability / Flow / Conciseness",
    color: "Orange",
    tier: "strong",
    description: '"for clarity, flow and readability"; "improved clarity/flow"',
    test: new RegExp(
      `\\b(?:for|improv\\w*|enhanc\\w*|better|greater|refin\\w*|strengthen\\w*|smooth\\w*)(?: (?:the|overall|better|improved|greater|sentence|narrative|prose))? ${QUALITY}(?:,? (?:and |& )?${QUALITY})+\\b`,
      "i",
    ),
  },
  {
    id: "improved-quality",
    group: "quality",
    tag: "Enhanced X / Refined X / Streamlined X",
    color: "Yellow",
    tier: "moderate",
    description: '"Improved/enhanced/refined/streamlined + quality noun"',
    test: new RegExp(
      `\\b(?:improv|enhanc|refin|streamlin|strengthen|smooth|polish|tighten|harmoni[sz]|standardi[sz]|normali[sz])\\w* (?:the |overall |article |sentence |narrative )?${QUALITY}\\b`,
      "i",
    ),
  },
  {
    id: "neutralizing",
    group: "promo",
    tag: "Neutralizing / Promotional tone",
    color: "Orange",
    tier: "strong",
    description: '"neutral tone", "promotional language", "neutrality"',
    test: /\bneutral(?:,|ity)? (?:and |, )?(?:\w+ )?(?:tone|language|wording|phrasing|terms|description|alternatives?)\b|\b(?:promotional|peacock|subjective|evaluative|emotive|editoriali[sz]ing) (?:tone|language|wording|phrasing|terms|claims|statements|adjectives)\b|\bneutrality\b/i,
  },
  {
    id: "policy-stack",
    group: "policy",
    tag: "Itemized policy / General policy nods",
    color: "Orange",
    tier: "strong",
    description: "Three or more distinct policy/quality nouns stacked in one summary",
    test: (s) => countPolicyNods(s) >= 3,
  },
  {
    id: "policy-pair",
    group: "policy",
    tag: "Itemized policy / General policy nods",
    color: "Orange",
    tier: "moderate", // only two nods: one step below the tag's colour
    description: "Two distinct policy/quality nouns",
    test: (s) => countPolicyNods(s) === 2,
  },
  {
    id: "sourced-x",
    group: "policy",
    tag: "Sourced X / Reliable sources",
    color: "Yellow",
    tier: "moderate",
    description: '"added sourced content", "with reliable sources", "improved sourcing"',
    test: /\b(?:added|adds?|adding|with|include[sd]?|including|expanded?) (?:new |additional |properly |fully |well[- ]|more )?(?:sourced|cited|referenced|verified|verifiable) (?:information|content|details|section|material|text|prose|paragraph|infobox|data|facts|claims|statements|coverage|biography|history)\b|\b(?:improv|strengthen|enhanc)\w* (?:the )?(?:sourcing|citations|references|attribution)\b/i,
  },
  {
    id: "inline-citations",
    tag: "Inline citations / Internal/wikilinks",
    color: "Orange",
    tier: "strong",
    description: '"inline citations", "internal links"',
    test: /\binline (?:citations?|references|refs)\b|\binternal (?:wiki)?links?\b|\binternal\/external links\b/i,
  },
  {
    id: "no-content-changes",
    tag: "No content changes",
    color: "Green",
    tier: "weak",
    description: '"no content changes", "no new content added"',
    test: /\bno (?:new )?(?:content|substantive|factual|text|substantial) (?:changes?|added|altered|removed|modified)\b|\bno content (?:was )?(?:changed|removed|altered)\b/i,
  },
  {
    id: "detached-description",
    tag: "Detached edit description",
    color: "Orange",
    tier: "strong",
    description: 'Talks about the edit as an object ("This edit provides…", "The changes focused on…")',
    test: /^\W*(?:the|this|these) (?:edit|edits|revision|revisions|changes?|update|updates|information|paragraph|addition|content|modification|contribution)s? (?:provides?|adds?|aims?|aimed|focus(?:es|ed)?|improves?|enhances?|ensures?|offers?|involves?|involved|include[sd]?|clarif(?:y|ies|ied)|helps?|contributes?|reflects?|highlights?|introduces?|replaces?|removes?|corrects?|presents?|expands?|pertains?|makes?|was|were|is|are)\b/i,
  },
  {
    id: "first-person-narration",
    tag: "First person",
    color: "Yellow",
    tier: "moderate",
    description: 'First-person narration of the edit ("I revised the content to…")',
    test: /^\W*(?:i|we) (?:have |also |then |carefully |manually )?(?:revised|rewrote|rewritten|rephrased|condensed|restructured|reorganized|reorganised|enhanced|refined|streamlined|improved|ensured|made|focused|incorporated|updated|edited|adjusted|modified|corrected|expanded|added|removed|changed|replaced|included|provided|integrated|polished|simplified|clarified)\b/i,
  },
  {
    id: "mentions-readers",
    tag: 'Mentioning "readers"',
    color: "Orange",
    tier: "strong",
    description: 'Mentions "readers"',
    test: /\breaders?\b/i,
  },
  {
    id: "arrow",
    tag: "Arrow symbol",
    color: "Orange",
    tier: "weak", // capped: nearly as common in human summaries (LR 1.5)
    description: "Arrow symbol (→ ➝ ⟶)",
    test: /[→➝⟶➔⇒➜]/,
  },
  {
    id: "bullets",
    tag: "Bullet point artifacts",
    color: "Orange",
    tier: "weak", // capped: LR 3.7
    description: "Bullet characters or flattened list markers",
    test: /[•▪◦●]|(?:^|\s)[*-] [A-Z][^*\n]{5,}\s[*-] [A-Z]/,
  },
  {
    id: "numbered-list",
    tag: "Numbered list",
    color: "Yellow",
    tier: "moderate",
    description: 'Flattened numbered list ("1. Fixed typos: … 2. Added …")',
    test: /(?:^|\s)1[.)] [A-Z][^]{5,}?\s2[.)] [A-Z]/,
  },
  {
    id: "emoji",
    tag: "Emoji",
    color: "Yellow",
    tier: "moderate",
    description: "Emoji",
    test: /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]{2}/u,
  },
  {
    id: "capital-headers",
    tag: 'Capital "headers"',
    color: "Orange",
    tier: "moderate", // capped: LR 8
    description: 'Title-case pseudo-headers ("Neutral tone – Removed…"); "Major expansion:" is major-comprehensive-header',
    test: /(?:^|[.;]\s+)(?:[A-Z][a-z]+(?: (?:[A-Z][a-z]+|&|and|of)){0,3})\s?(?:–|—|:)\s[A-Z][a-z]+ed\b/,
  },
  {
    id: "terse-itemization",
    tag: "Terse parenthetical itemization",
    color: "Yellow",
    tier: "moderate",
    description: 'Parenthetical lists ("added sources (NYT, BBC, Guardian)")',
    test: /\((?:[^(),;]{2,40}[,;] ){2,}[^()]{2,60}\)/,
  },
  {
    id: "curly-quotes",
    tag: "Curly quotes",
    color: "Orange",
    tier: "moderate", // capped: fires on 0.25% of human summaries
    description: "Curly quotes/apostrophes",
    test: /[“”‘’]/,
  },
  {
    id: "quoted-whole",
    tag: "Quotes around response",
    color: "Green",
    tier: "weak",
    description: "Whole summary wrapped in quotes (copy-pasted)",
    test: /^\s*["“][^"“”]{30,}["”]\s*$/,
  },
  {
    id: "truncated",
    tag: "Trailing off",
    color: "Yellow",
    tier: "moderate",
    description: "Hits the 500-character limit mid-sentence",
    test: (s) => s.length >= 490 && !/[.!?)\]]\s*$/.test(s),
  },
  {
    id: "pedantic-hyphens",
    tag: "Pedantic compound hyphens",
    color: "Yellow",
    tier: "moderate",
    description: 'Pedantic compound hyphens ("source-backed", "year-specific", "fact-based")',
    test: /\b(?:source|fact|evidence|year|era|date|citation|reference|reader|policy|media|sentence|section|article|text|content|research|data|context|period|role|time|topic|subject|career)-(?:backed|based|specific|focused|driven|aligned|level|appropriate|heavy|oriented|supported|compliant|neutral|friendly)\b/i,
  },
  {
    id: "x-or-y",
    tag: "X or Y",
    color: "Yellow",
    tier: "moderate",
    description: '"outdated or mismatched", "subjective or promotional"',
    test: /\b(?:outdated|unsourced|promotional|redundant|subjective|vague|weak|mismatched|informal|speculative|unverified|unverifiable|duplicate|broken|dramatic|unreliable|contentious|editorial|evaluative|inflated|loaded) or (?:potentially |overly |otherwise )?(?:outdated|unsourced|promotional|redundant|subjective|vague|weak|mismatched|informal|speculative|unverified|unverifiable|duplicate|broken|dramatic|unreliable|contentious|editorial|evaluative|inflated|loaded|emotive|non-neutral|incorrect|irrelevant|misleading|exaggerated|inaccurate|unclear)\b/i,
  },
  {
    id: "rather-than",
    tag: "X rather than Y",
    color: "Orange",
    tier: "moderate", // capped: LR 7.9
    description: '"…rather than…"',
    test: /\brather than\b/i,
  },
  {
    id: "suggestion-style",
    tag: "Suggestion-style",
    color: "Yellow",
    tier: "moderate",
    description: 'Critique phrased as advice (\'"Influential" is subjective and lacks…\')',
    test: /^\W*["“][^"”]{2,60}["”] (?:is|are|was|sounds|feels|comes across|can|could|may|might|implies|suggests)\b/i,
  },
  {
    id: "comprehensive",
    tag: "Comprehensive / Overview / Key X / Relevant X",
    color: "Yellow",
    tier: "moderate",
    description: '"comprehensive", "overview", "key details", "relevant information"',
    test: /\bcomprehensive\b|\boverview\b|\bkey (?:details|information|facts|points|aspects|figures|milestones|events|achievements|changes|improvements|contributions|updates)\b|\brelevant (?:information|details|context|content|sources|citations|links)\b/i,
  },
  {
    id: "additionally",
    tag: "Additionally, / Furthermore",
    color: "Yellow",
    tier: "moderate",
    description: 'Sentence-initial "Additionally," / "Furthermore,"',
    test: /(?:^|[.;]\s+)(?:additionally|furthermore|moreover|overall),/i,
  },
  {
    id: "avoided-x",
    tag: "Avoided X / Aimed to X",
    color: "Yellow",
    tier: "moderate",
    description: '"avoided…", "aimed to…"',
    test: /\b(?:avoid(?:ed|ing)|aim(?:ed|ing|s)? to)\b/i,
  },

  // --- one rule per tag, tier from the tag's colour ----------------------
  // A rule is demoted below its colour when it also fires on human summaries:
  // giveaway needs zero human hits in 44.5k; strong needs a likelihood ratio
  // (AI rate / human rate) of at least 20 and a human rate of at most 0.1%;
  // moderate needs a likelihood ratio of at least 5 and a human rate of at most 0.5%.
  // Overlapping rules share a `group`, and only the strongest match per group counts.

  // Red
  grouped("promo", tagRule("promotional-tone", "Promotional tone", "Red", "strong", /\bpromotional (?:tone|language|wording|phrasing|terms|content|claims|statements|adjectives|descriptors)\b/i, "capped: 6 human hits")),
  grouped("policy", tagRule("independent-sources", "Independent sources", "Red", "strong", /\bindependent,? (?:\w+ ){0,2}(?:sources?|references?|coverage|citations?)\b/i, "capped: 6 human hits")),
  grouped("policy", tagRule("third-party-sources", "Third party sources", "Red", "strong", /\bthird[- ]party (?:\w+ )?(?:sources?|references?|coverage|citations?)\b/i, "capped: 1 human hit")),
  tagRule("major-comprehensive-header", "Major/comprehensive X:", "Red", "strong", /^\W*(?:major|comprehensive|significant|substantial|extensive|complete|full|general) (?:\w+ ){0,3}?(?:expansion|rewrite|update|overhaul|revision|cleanup|clean-up|restructur\w*|improvements?|edits?|changes|copyedit|corrections|fixes)\b[^:.;]{0,40}:/i, 'capped: AWB "General fixes:"'),
  tagRule("cleaned-x", "Cleaned X", "Red", "giveaway", /\bcleaned (?!up\b)(?:\w+ )?(?:tone|wording|language|phrasing|prose|formatting|citations?|references?|refs|text|content|structure|grammar|section|lead|infobox)\b/i),
  tagRule("diverse", "Diverse", "Red", "strong", /\bdivers(?:e|ity)\b/i, "capped: 2 human hits"),
  tagRule("upgraded-x", "Upgraded X", "Red", "moderate", /\bupgraded\b/i, "capped: LR 15"),
  tagRule("deduplicated-x", "Deduplicated X", "Red", "giveaway", /\bde-?duplicated?\b/i),

  // Orange
  grouped("policy", tagRule("verifiability", "Verifiability", "Orange", "strong", /\bverifiability\b/i)),
  grouped("quality", tagRule("readability", "Readability", "Orange", "strong", /\breadability\b/i)),
  grouped("policy", tagRule("notability", "Notability", "Orange", "moderate", /\bnotability\b/i, "capped: LR 7.6")),
  tagRule("factual-content", "Factual content", "Orange", "strong", /\bfactual(?:ly)? (?:content|information|details|accuracy|claims|statements|tone|language|description|data|summary|basis)\b/i),
  grouped("policy", tagRule("secondary-primary-sources", "Secondary/primary sources", "Orange", "strong", /\b(?:secondary|primary|tertiary)(?:\/\w+)? (?:sources?|references?|coverage)\b/i)),
  grouped("promo", tagRule("subjective-figurative", "Subjective/figurative", "Orange", "strong", /\b(?:subjective|figurative|flowery|puffery|peacock)\b/i)),
  tagRule("formalized", "Formalized", "Orange", "strong", /\bformali[sz](?:ed|ing)\b/i),
  tagRule("foundational", "Foundational", "Orange", "strong", /\bfoundational\b/i),
  tagRule("refreshed-x", "Refreshed X", "Orange", "strong", /\brefreshed\b/i),
  tagRule("tidied-x", "Tidied X", "Orange", "weak", /\btidied\b/i, 'capped: "tidied up" is common human usage'),
  tagRule("refactored-x", "Refactored X", "Orange", "moderate", /\brefactor(?:ed|ing)\b/i, "capped: LR 7.5"),
  tagRule("utilize", "Utilize", "Orange", "strong", /\butili[sz](?:e|es|ed|ing|ation)\b/i),
  tagRule("delve", "Delve", "Orange", "strong", /\bdelv(?:e|es|ed|ing)\b/i),
  tagRule("intricate", "Intricate", "Orange", "moderate", /\bintricate\b/i, "capped: LR 15"),
  tagRule("focused-on", "Focused on X", "Orange", "strong", /\bfocus(?:ed|ing)? on\b/i),

  // Yellow
  grouped("quality", tagRule("streamlined-x", "Streamlined X", "Yellow", "moderate", /\bstreamlined\b/i)),
  grouped("quality", tagRule("smoothed-x", "Smoothed X", "Yellow", "moderate", /\bsmoothed\b/i)),
  tagRule("consolidated-x", "Consolidated X", "Yellow", "moderate", /\bconsolidated\b/i),
  tagRule("modernized-x", "Modernized X", "Yellow", "moderate", /\bmoderni[sz]ed\b/i),
  tagRule("optimized-x", "Optimized X", "Yellow", "moderate", /\boptimi[sz]ed\b/i),
  tagRule("unified-x", "Unified X", "Yellow", "moderate", /\bunified\b/i),
  tagRule("rebuilt-x", "Rebuilt X", "Yellow", "moderate", /\brebuilt\b/i),
  grouped("quality", tagRule("enhanced-x", "Enhanced X", "Yellow", "moderate", /\benhanced\b/i)),
  tagRule("resolved-x", "Resolved X", "Yellow", "moderate", /\bresolved\b/i),
  tagRule("distinguished-x", "Distinguished X", "Yellow", "moderate", /\bdistinguished\b/i),
  tagRule("precise-x", "Precise X", "Yellow", "moderate", /\bprecise\b/i),
  tagRule("emphasized", "Emphasized", "Yellow", "moderate", /\bemphasi[sz]ed\b/i),
  tagRule("highlight", "Highlight", "Yellow", "moderate", /\bhighlight(?:s|ed|ing)?\b/i),
  tagRule("reflecting", "Reflecting", "Yellow", "moderate", /\breflect(?:s|ed|ing)?\b/i),
  tagRule("pivotal", "Pivotal", "Yellow", "moderate", /\bpivotal\b/i),
  tagRule("showcased", "Showcased", "Yellow", "moderate", /\bshowcas(?:e|es|ed|ing)\b/i),
  tagRule("foster", "Foster", "Yellow", "moderate", /\bfoster(?:s|ed|ing)?\b/i),
  tagRule("underscore", "Underscore", "Yellow", "moderate", /\bunderscor(?:e|es|ed|ing)\b/i),
  tagRule("crucial", "Crucial", "Yellow", "moderate", /\bcrucial\b/i),
  tagRule("enriching", "Enriching", "Yellow", "moderate", /\benrich(?:ing|ed|es)?\b/i),
  tagRule("valuable", "Valuable", "Yellow", "moderate", /\bvaluable\b/i),
  tagRule("insights", "Insights", "Yellow", "moderate", /\binsights?\b/i),
  tagRule("unique", "Unique", "Yellow", "moderate", /\bunique\b/i),
  tagRule("robust-x", "Robust X", "Yellow", "moderate", /\brobust (?:citations?|sourcing|sources|references)\b/i),
  grouped("quality", tagRule("flow", "Flow", "Yellow", "moderate", /\bflow\b/i)),
  tagRule("maintained-x", "Maintained X", "Yellow", "moderate", /\bmaintained\b/i),
  grouped("policy", tagRule("significant-coverage", "Significant coverage", "Yellow", "moderate", /\bsignificant coverage\b/i)),
  tagRule("peer-reviewed", "Peer reviewed X", "Yellow", "moderate", /\bpeer[- ]reviewed\b/i),
  tagRule("scannability", "Scannability", "Yellow", "moderate", /\bscannab(?:le|ility)\b/i),
  tagRule("source-based", "Source-based", "Yellow", "moderate", /\bsource-(?:based|backed|supported)\b/i),
  tagRule("appropriate-x", "Appropriate X", "Yellow", "moderate", /\bappropriate (?:sources?|citations?|references?|categories|links?|tone|wording|section|templates?|formatting|context)\b/i),
  tagRule("broader-x", "Broader X", "Yellow", "moderate", /\bbroader (?:context|trends?|significance|impact|scope|coverage|historical)\b/i),

  // Green
  grouped("quality", tagRule("refined-x", "Refined X", "Green", "weak", /\brefined\b/i)),
  grouped("quality", tagRule("strengthened-x", "Strengthened X", "Green", "weak", /\bstrengthened\b/i)),
  tagRule("harmonized-x", "Harmonized X", "Green", "weak", /\bharmoni[sz]ed\b/i),
  tagRule("pruned-x", "Pruned X", "Green", "weak", /\bpruned\b/i),
  tagRule("softened-x", "Softened X", "Green", "weak", /\bsoftened\b/i),
  tagRule("normalized-x", "Normalized X", "Green", "weak", /\bnormali[sz]ed\b/i),
  tagRule("reconciled-x", "Reconciled X", "Green", "weak", /\breconciled\b/i),
  grouped("quality", tagRule("clarity", "Clarity", "Green", "weak", /\bclarity\b/i)),
  grouped("quality", tagRule("conciseness", "Conciseness", "Green", "weak", /\bconcis(?:eness|ion)\b/i)),
  tagRule("retained-x", "Retained X", "Green", "weak", /\bretained\b/i),
  tagRule("preserved-x", "Preserved X", "Green", "weak", /\bpreserved\b/i),
  tagRule("brief-x", "Brief X", "Green", "weak", /\bbrief (?:overview|description|summary|mention|history|background|introduction|section|biography)\b/i),
  tagRule("structured-x", "Structured X", "Green", "weak", /\bstructured (?:sections?|format|layout|content|overview|information|summary|biography)\b/i),
  tagRule("strictly", "Strictly", "Green", "weak", /\bstrictly\b/i),

  // Blue (not in the legend; treated as weak)
  tagRule("landscape-figurative", "Landscape (figurative)", "Blue", "weak", /\blandscape of\b/i),
];

function grouped(group: string, rule: Rule): Rule {
  return { ...rule, group };
}

function tagRule(id: string, tag: string, color: Color, tier: Tier, test: RegExp, note?: string): Rule {
  return { id, tag, color, tier, description: `"${tag}" tag${note ? ` (${note})` : ""}`, test };
}

// Anti-signs (indicate a human or automated, non-LLM summary) --------------

export type AntiTier = "definitive" | "strong" | "moderate" | "weak";

export interface AntiRule {
  id: string;
  tier: AntiTier;
  description: string;
  test: RegExp | ((s: string, body: string) => boolean);
}

/** Section auto-comment that MediaWiki prepends: "/* Heading *\/ ". */
export const AUTOCOMMENT = /^\s*\/\*.*?\*\/\s*/;

/** Shorthand tokens from WP:ESL (edit summary legend) and common practice. */
const SHORTHAND =
  "(?:[+-]|[+-]?(?:ce|c\\/e|copyedit|copy ?edit|cpedit|typos?|sp|spelling|spell|fmt|format|formatting|grammar|gram|gr|punct(?:uation)?|rm|rmv|rem|remove|removed|rv|rvv|rvt|revert|reverted|wl|wikilinks?|wlink|links?|linked|unlink|delink|dab|disambig|cats?|category|ref|refs|reflist|cite|cites|cn|stub|sort|tidy|tweak|tweaks|minor|fix|fixes|fixed|mos|nbsp|dash(?:es)?|update|updated|upd|updt|img|image|pic|photo|infobox|ib|dup|dupe|sect|sec|section|lnk|lk|ok|done|thanks|thx|ty|reply|replied|re|comment|cmt|vandalism|vand|test|sandbox|ext|el|see also|sa|sic|ws|whitespace|spacing|caps|cap|lc|uc|italics|ital|bold|bolding|tag|tags|sources?|src|date|dates|added|add|adding|new|expand|expanded|expansion|edit|edits|edited|correction|corrected|clean ?up|cleanup|layout|rewording|reword|reworded|wording|clarify|clarification|ok|yes|no|per talk|talk|see talk|moved?|merge|merged|split|redirect|rd|r|wp|pov|npov|or|bio|blp|unsourced|uns|nn|wording|grammar fix|spelling fix|typo fix|link fix)\\b\\.?)";

export const ANTI_SIGNS: AntiRule[] = [
  {
    id: "empty",
    tier: "definitive",
    description: "Empty summary",
    test: (_s, body) => body.trim() === "",
  },
  {
    id: "software-generated",
    tier: "definitive",
    description: "MediaWiki-generated summaries (revert, undo, page move, page creation, redirect, protection, new section, replies)",
    test: /^\s*(?:\[\[WP:AES\|[←→]\]\]\s*)?(?:Reverted (?:\d+ )?(?:\[\[WP:AGF\|good faith\]\] )?edits? by|Undid (?:\d+ )?revisions? (?:\d+|\[\[Special:Diff|from \[\[)|Declining submission:|Commenting on submission|Submitting using \[\[|Cleaning up (?:accepted )?\[\[WP:AFC|Publishing accepted \[\[|Undo revision|Restored revision \d+|Reverting possible vandalism|Reverted to revision|Revert to revision|Rollback|Removed redirect to|Redirected page to|Created page with ['"]|Created page by|Blanked the page|Replaced content with ['"]|Changed protection|Protected ["“]|Removed protection|\S.{0,60} moved page \[\[|Changed (?:visibility|content model)|Reply\s*$|Assessment \(|Added (?:\[\[:?Category|Category:)|Removed (?:\[\[:?Category|Category:)|Merged? (?:content )?(?:from|to) \[\[|Updated? page with|Disambiguated:? \[\[|(?:\[\[[^\]]*\|)?Typo(?:\/[^,]*)? fix(?:ing|es)\]?\]?, replaced:|Bot: |Tagging (?:for|with) |Adding (?:\{\{|\[\[)|Moving from \[\[Category|Clean up(?: and)? \[\[WP:AWB)/i,
  },
  {
    id: "tool-tag",
    tier: "definitive",
    description: "Semi-automated tool signature (Twinkle, Huggle, HotCat, AWB, ReFill, Rater, Citation bot, IABot, JWB…)",
    test: /\[\[(?:WP|Wikipedia|Project|User|Help):(?:TW|Twinkle|HG|Huggle|HC|HotCat|AWB|AutoWikiBrowser|REFILL|ReFill|Rater|STiki|RW|RedWarn|UV|Ultraviolet|DisamAssist|JWB|ProveIt|Citation[ _]bot|UTM|Reflinks|IABot|Cat-a-lot|AFCH|FURME|NPPHELP|PageTriage|Shortdesc helper|SDH|XFDC|DiscussionTools|CSDH|MoreMenu|WikiLove|FWDS|Evad37)\b|\(using \[\[|\| ?#UCB_|#IABot|\bvia (?:WP:)?(?:JWB|AWB|HotCat|Twinkle)\b|\((?:TW|TWG|HG|HG \d)\)|\[\[Help:Citation tool|\bAlter: \w+\. Add: |^\(\[\[c:GR\|GR\]\]\)/i,
  },
  {
    id: "signature",
    tier: "strong",
    description: "Signature or user-link with talk link inside the summary",
    test: /~~~~|--\s*\[\[User:/,
  },
  {
    id: "autocomment-only",
    tier: "definitive",
    description: "Only the auto-generated section heading (optionally + 'new section')",
    test: (s, body) => AUTOCOMMENT.test(s) && /^\s*(?:new section|reply|replied|comment|re|response)?\s*$/i.test(body),
  },
  {
    id: "shorthand-only",
    tier: "definitive",
    description: 'Summary consists only of edit-summary shorthand ("ce", "rv vandalism", "+cat, typo")',
    test: (_s, body) =>
      new RegExp(`^\\s*(?:${SHORTHAND}[\\s,;:/&+\\-]*)+\\s*$`, "i").test(body),
  },
  {
    id: "very-short",
    tier: "strong",
    description: "Very short (≤ 3 words / 25 chars)",
    test: (_s, body) => body.trim().length <= 25 || body.trim().split(/\s+/).length <= 3,
  },
  {
    id: "lowercase-i",
    tier: "strong",
    description: 'Lowercase "i" as a pronoun, or "im"/"dont"/"u" style texting',
    test: /(?:^|[\s,.])i(?:'m|’m|'ve|'d|'ll)?\s(?=[a-z])|\b(?:dont|doesnt|didnt|cant|wont|isnt|im|ive|thats|wasnt|theres|u|ur|pls|plz|thx|lol|lmao|idk|imo|imho|btw|tbh|wtf|omg)\b/,
  },
  {
    id: "profanity",
    tier: "strong",
    description: "Profanity, insults, or doubled exclamation/question marks",
    test: /\b(?:fuck(?:s|ed|er|ers|ing|in)?|shit(?:s|ty|ting)?|bullshit|damn(?:ed|it)?|crap(?:py)?|stupid|idiot(?:s|ic)?|moron(?:s|ic)?|dumb(?:ass)?|wtf|retard(?:s|ed)?|bitch(?:es|ing)?|asshole|sucks)\b|[!?]{2,}/i,
  },
  {
    id: "shouting",
    tier: "moderate",
    description: "ALL CAPS shouting (three or more capitalised words in a row)",
    test: /\b[A-Z]{4,}(?:\s+[A-Z]{3,}){2,}\b/,
  },
  {
    id: "talk-reference",
    tier: "weak",
    description: 'Points to a discussion ("per talk", "see talk page", "[[Talk:…]]", "@User")',
    test: /\b(?:per|see|as discussed (?:on|at)|discussed (?:on|at)|consensus (?:on|at)) (?:the )?talk\b|\[\[(?:User )?Talk:|\bper \[\[/i,
  },
  {
    id: "specific-shortcut-link",
    tier: "weak",
    description: "Links one specific policy section with wikilink brackets ([[MOS:OVERLINK]])",
    test: /\[\[(?:WP|MOS|H|Help|Wikipedia):[A-Z0-9#_ ]+(?:\|[^\]]+)?\]\]/,
  },
  {
    id: "lowercase-start",
    tier: "weak",
    description: "Starts with a lowercase letter",
    test: (_s, body) => /^[a-z]/.test(body.trim()),
  },
  {
    id: "url-only",
    tier: "strong",
    description: "Body is just a URL or a wikilink",
    test: (_s, body) => /^\s*(?:https?:\/\/\S+|\[\[[^\]]+\]\])\s*$/.test(body),
  },
];
