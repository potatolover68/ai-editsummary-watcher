// Vendored from ai-editsummary-heuristics@be30fa7 (src/rules.ts). Edit there and re-copy.
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

export interface Rule {
  id: string;
  /** Dataset tag(s) this rule approximates, if any. */
  tag?: string;
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
    tier: "giveaway",
    description: 'Chatbot reply preamble ("Sure! Here\'s an edit summary…", "Certainly.")',
    test: /^\W*(?:sure|certainly|absolutely|of course)\b[!,.]|\bhere(?:'|’)?s (?:a |an |the |my |your )?(?:\w+ ){0,3}(?:edit summary|summary|breakdown|version|revised|rewrite)\b|\bclaude responded\b|\bask chatgpt\b|\byou (?:can|could|may) use\b/i,
  },
  {
    id: "summary-label",
    tag: "Saying it's a summary",
    tier: "giveaway",
    description: 'Summary labels itself ("Edit summary:", "Concise edit summary:")',
    test: /^\W*(?:\*\*)?\s*(?:concise |suggested |short |brief |final )?edit summary\s*(?:\*\*)?\s*[:：]/i,
  },
  {
    id: "markdown-bold",
    tag: "Markdown",
    tier: "giveaway",
    description: "Markdown bold/headers or code fences",
    test: /\*\*[^*\n]{2,80}\*\*|```|^#{1,3} \w/,
  },
  {
    id: "provided-text",
    tag: "Provided text",
    tier: "giveaway",
    description: 'Refers to text given to a chatbot ("the provided paragraph", "the latest screenshot")',
    test: /\bthe provided (?:text|paragraph|content|passage|draft|list|section|sentence|article|information)\b|\b(?:latest|attached|uploaded) (?:screenshots?|image)\b/i,
  },
  {
    id: "second-person-change",
    tag: "User communication",
    tier: "moderate", // humans say "you removed…" in reverts too
    description: 'Describes the user\'s edit in second person ("you replaced a comma…")',
    test: /\byou (?:replaced|added|removed|changed|made|corrected|rephrased|rewrote|updated|fixed|expanded)\b/i,
  },
  {
    id: "ai-disclosure",
    tag: "It says so",
    tier: "giveaway",
    description: 'Discloses AI use ("AI-assisted", "generated with ChatGPT")',
    test: /\b(?:ai|llm)[- ]assist(?:ed|ance)\b|\b(?:generated|drafted|written|created) (?:with|by|using) (?:the help of )?(?:an? )?(?:ai|llm|chatgpt|gpt|claude|gemini|copilot)\b/i,
  },
  {
    id: "unicode-letter-markup",
    tag: "Unicode letter markup",
    tier: "giveaway",
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
    tier: "strong",
    description: '"…while preserving/retaining/maintaining X"',
    test: /\bwhile (?:preserving|retaining|maintaining|keeping)\b/i,
  },
  {
    id: "without-altering",
    tag: "Without doing X",
    tier: "strong",
    description: '"without altering the meaning/content", "without overstating"',
    test: /\bwithout (?:altering|changing|modifying|affecting|overstating|embellishment|removing (?:any )?(?:sourced|content|information))\b/i,
  },
  {
    id: "afc-reviewer-feedback",
    tag: "AfC references",
    tier: "strong",
    description: 'Addresses AfC reviewer feedback ("Addressed reviewer feedback by…")',
    test: /\b(?:address(?:ed|es|ing)?|per|following|in response to|implement(?:ed|ing)?|incorporat(?:ed|ing))\b (?:the |all |prior |previous |recent )?(?:afc |draft )?(?:reviewer|review)(?:'s|s'|s)? (?:feedback|comments|concerns|notes)\b/i,
  },
  {
    id: "wikipedia-guidelines",
    tag: "Mentioning Wikipedia",
    tier: "strong",
    description: 'Spells out that edits follow "Wikipedia\'s guidelines/standards"',
    test: /\bwikipedia(?:'|’)?s?(?: \w+)? (?:guidelines?|policies|policy|standards?|style|manual of style|requirements|conventions|norms|neutrality|content)\b|\b(?:for|on) wikipedia\b(?! ?(?:talk|:))/i,
  },
  {
    id: "compliance",
    tag: "Compliance with / Adhering to X / Align with",
    tier: "strong",
    description: '"to comply with / adhere to / align with / in line with" guidelines',
    test: /\b(?:in )?complian(?:ce|t) with\b|\bto comply with\b|\badher(?:e|es|ed|ing|ence) to\b|\b(?:better |to |more closely )?align(?:s|ed|ing)? (?:it |the \w+ |them )?with\b|\bin (?:line|keeping) with (?:wikipedia|wp|the|encyclopedic|mos)/i,
  },
  {
    id: "ensure",
    tag: "Ensured X",
    tier: "moderate",
    description: '"ensure/ensuring" in a summary',
    test: /\bensur(?:e|ed|es|ing)\b/i,
  },
  {
    id: "encyclopedic-tone",
    tag: "Encyclopedic tone",
    tier: "strong",
    description: '"encyclopedic tone/style/language"',
    test: /\b(?:more |a |an |neutral,? )?encyclop(?:a)?edic (?:tone|style|language|register|standards?|voice|presentation|format|alternatives?)\b/i,
  },
  {
    id: "quality-for",
    tag: "Clarity / Readability / Flow / Conciseness",
    tier: "strong",
    description: '"for clarity, flow and readability"; "improved clarity/flow"',
    test: new RegExp(
      `\\b(?:for|improv\\w*|enhanc\\w*|better|greater|refin\\w*|strengthen\\w*|smooth\\w*)(?: (?:the|overall|better|improved|greater|sentence|narrative|prose))? ${QUALITY}(?:,? (?:and |& )?${QUALITY})+\\b`,
      "i",
    ),
  },
  {
    id: "improved-quality",
    tag: "Enhanced X / Refined X / Streamlined X",
    tier: "moderate",
    description: '"Improved/enhanced/refined/streamlined + quality noun"',
    test: new RegExp(
      `\\b(?:improv|enhanc|refin|streamlin|strengthen|smooth|polish|tighten|harmoni[sz]|standardi[sz]|normali[sz])\\w* (?:the |overall |article |sentence |narrative )?${QUALITY}\\b`,
      "i",
    ),
  },
  {
    id: "procedural-verbs",
    tag: "Refined/Streamlined/Smoothed/Formalized/Consolidated X",
    tier: "weak",
    description: "AI-favoured procedural verbs",
    test: /\b(?:refined|streamlined|smoothed|formali[sz]ed|consolidated|strengthened|harmoni[sz]ed|refactored|deduplicated|pruned|softened|modernized|tidied)\b/i,
  },
  {
    id: "neutralizing",
    tag: "Neutralizing / Promotional tone",
    tier: "moderate",
    description: '"neutral tone", "promotional language", "neutrality"',
    test: /\bneutral(?:,|ity)? (?:and |, )?(?:\w+ )?(?:tone|language|wording|phrasing|terms|description|alternatives?)\b|\b(?:promotional|peacock|subjective|evaluative|emotive|editoriali[sz]ing) (?:tone|language|wording|phrasing|terms|claims|statements|adjectives)\b|\bneutrality\b/i,
  },
  {
    id: "policy-stack",
    tag: "Itemized policy / General policy nods",
    tier: "strong",
    description: "Three or more distinct policy/quality nouns stacked in one summary",
    test: (s) => countPolicyNods(s) >= 3,
  },
  {
    id: "policy-pair",
    tag: "Itemized policy / General policy nods",
    tier: "weak",
    description: "Two distinct policy/quality nouns",
    test: (s) => countPolicyNods(s) === 2,
  },
  {
    id: "sourced-x",
    tag: "Sourced X / Reliable sources",
    tier: "moderate",
    description: '"added sourced content", "with reliable sources", "improved sourcing"',
    test: /\b(?:added|adds?|adding|with|include[sd]?|including|expanded?) (?:new |additional |properly |fully |well[- ]|more )?(?:sourced|cited|referenced|verified|verifiable) (?:information|content|details|section|material|text|prose|paragraph|infobox|data|facts|claims|statements|coverage|biography|history)\b|\b(?:improv|strengthen|enhanc)\w* (?:the )?(?:sourcing|citations|references|attribution)\b/i,
  },
  {
    id: "inline-citations",
    tag: "Inline citations / Internal/wikilinks",
    tier: "moderate",
    description: '"inline citations", "internal links"',
    test: /\binline (?:citations?|references|refs)\b|\binternal (?:wiki)?links?\b|\binternal\/external links\b/i,
  },
  {
    id: "no-content-changes",
    tag: "No content changes",
    tier: "moderate",
    description: '"no content changes", "no new content added"',
    test: /\bno (?:new )?(?:content|substantive|factual|text|substantial) (?:changes?|added|altered|removed|modified)\b|\bno content (?:was )?(?:changed|removed|altered)\b/i,
  },
  {
    id: "detached-description",
    tag: "Detached edit description",
    tier: "strong",
    description: 'Talks about the edit as an object ("This edit provides…", "The changes focused on…")',
    test: /^\W*(?:the|this|these) (?:edit|edits|revision|revisions|changes?|update|updates|information|paragraph|addition|content|modification|contribution)s? (?:provides?|adds?|aims?|aimed|focus(?:es|ed)?|improves?|enhances?|ensures?|offers?|involves?|involved|include[sd]?|clarif(?:y|ies|ied)|helps?|contributes?|reflects?|highlights?|introduces?|replaces?|removes?|corrects?|presents?|expands?|pertains?|makes?|was|were|is|are)\b/i,
  },
  {
    id: "first-person-narration",
    tag: "First person",
    tier: "moderate",
    description: 'First-person narration of the edit ("I revised the content to…")',
    test: /^\W*(?:i|we) (?:have |also |then |carefully |manually )?(?:revised|rewrote|rewritten|rephrased|condensed|restructured|reorganized|reorganised|enhanced|refined|streamlined|improved|ensured|made|focused|incorporated|updated|edited|adjusted|modified|corrected|expanded|added|removed|changed|replaced|included|provided|integrated|polished|simplified|clarified)\b/i,
  },
  {
    id: "mentions-readers",
    tag: 'Mentioning "readers"',
    tier: "moderate",
    description: 'Mentions "readers"',
    test: /\breaders?\b/i,
  },
  {
    id: "arrow",
    tag: "Arrow symbol",
    tier: "moderate",
    description: "Arrow symbol (→ ➝ ⟶)",
    test: /[→➝⟶➔⇒➜]/,
  },
  {
    id: "bullets",
    tag: "Bullet point artifacts",
    tier: "strong",
    description: "Bullet characters or flattened list markers",
    test: /[•▪◦●]|(?:^|\s)[*-] [A-Z][^*\n]{5,}\s[*-] [A-Z]/,
  },
  {
    id: "numbered-list",
    tag: "Numbered list",
    tier: "strong",
    description: 'Flattened numbered list ("1. Fixed typos: … 2. Added …")',
    test: /(?:^|\s)1[.)] [A-Z][^]{5,}?\s2[.)] [A-Z]/,
  },
  {
    id: "emoji",
    tag: "Emoji",
    tier: "strong",
    description: "Emoji",
    test: /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]{2}/u,
  },
  {
    id: "capital-headers",
    tag: 'Capital "headers" / Major/comprehensive X:',
    tier: "moderate",
    description: 'Title-case pseudo-headers ("Neutral tone – Removed…", "Major expansion: …")',
    test: /^\W*(?:major|comprehensive|significant|substantial|extensive|complete|full|general|minor) (?:\w+ ){0,3}?(?:expansion|rewrite|update|overhaul|revision|cleanup|clean-up|restructur\w*|improvements?|edits?|changes|copyedit|corrections|fixes)\b[^:.;]{0,40}:|(?:^|[.;]\s+)(?:[A-Z][a-z]+(?: (?:[A-Z][a-z]+|&|and|of)){0,3})\s?(?:–|—|:)\s[A-Z][a-z]+ed\b/,
  },
  {
    id: "terse-itemization",
    tag: "Terse parenthetical itemization",
    tier: "weak",
    description: 'Parenthetical lists ("added sources (NYT, BBC, Guardian)")',
    test: /\((?:[^(),;]{2,40}[,;] ){2,}[^()]{2,60}\)/,
  },
  {
    id: "curly-quotes",
    tag: "Curly quotes",
    tier: "weak",
    description: "Curly quotes/apostrophes",
    test: /[“”‘’]/,
  },
  {
    id: "quoted-whole",
    tag: "Quotes around response",
    tier: "moderate",
    description: "Whole summary wrapped in quotes (copy-pasted)",
    test: /^\s*["“][^"“”]{30,}["”]\s*$/,
  },
  {
    id: "truncated",
    tag: "Trailing off",
    tier: "moderate",
    description: "Hits the 500-character limit mid-sentence",
    test: (s) => s.length >= 490 && !/[.!?)\]]\s*$/.test(s),
  },
  {
    id: "pedantic-hyphens",
    tag: "Pedantic compound hyphens",
    tier: "weak",
    description: 'Pedantic compound hyphens ("source-backed", "year-specific", "fact-based")',
    test: /\b(?:source|fact|evidence|year|era|date|citation|reference|reader|policy|media|sentence|section|article|text|content|research|data|context|period|role|time|topic|subject|career)-(?:backed|based|specific|focused|driven|aligned|level|appropriate|heavy|oriented|supported|compliant|neutral|friendly)\b/i,
  },
  {
    id: "x-or-y",
    tag: "X or Y",
    tier: "weak",
    description: '"outdated or mismatched", "subjective or promotional"',
    test: /\b(?:outdated|unsourced|promotional|redundant|subjective|vague|weak|mismatched|informal|speculative|unverified|unverifiable|duplicate|broken|dramatic|unreliable|contentious|editorial|evaluative|inflated|loaded) or (?:potentially |overly |otherwise )?(?:outdated|unsourced|promotional|redundant|subjective|vague|weak|mismatched|informal|speculative|unverified|unverifiable|duplicate|broken|dramatic|unreliable|contentious|editorial|evaluative|inflated|loaded|emotive|non-neutral|incorrect|irrelevant|misleading|exaggerated|inaccurate|unclear)\b/i,
  },
  {
    id: "rather-than",
    tag: "X rather than Y",
    tier: "weak",
    description: '"…rather than…"',
    test: /\brather than\b/i,
  },
  {
    id: "suggestion-style",
    tag: "Suggestion-style",
    tier: "strong",
    description: 'Critique phrased as advice (\'"Influential" is subjective and lacks…\')',
    test: /^\W*["“][^"”]{2,60}["”] (?:is|are|was|sounds|feels|comes across|can|could|may|might|implies|suggests)\b/i,
  },
  {
    id: "ai-vocab",
    tag: "AIWORDS / AIVOCAB",
    tier: "moderate",
    description: "Classic AI vocabulary (delve, pivotal, showcase, foster, tapestry…)",
    test: /\b(?:delv(?:e|es|ed|ing)|pivotal|showcas(?:e|es|ed|ing)|foster(?:s|ed|ing)?|tapestry|intricate|underscor(?:e|es|ed|ing)|testament|vibrant|meticulous(?:ly)?|seamless(?:ly)?|valuable insights?|insights? into|rich (?:history|heritage|tapestry)|nuanced|crucial|holistic|landscape of|ever-evolving|multifaceted|enriching|robust (?:citations?|sourcing|references))\b/i,
  },
  {
    id: "comprehensive",
    tag: "Comprehensive / Overview / Key X / Relevant X",
    tier: "weak",
    description: '"comprehensive", "overview", "key details", "relevant information"',
    test: /\bcomprehensive\b|\boverview\b|\bkey (?:details|information|facts|points|aspects|figures|milestones|events|achievements|changes|improvements|contributions|updates)\b|\brelevant (?:information|details|context|content|sources|citations|links)\b/i,
  },
  {
    id: "additionally",
    tag: "Additionally, / Furthermore",
    tier: "weak",
    description: 'Sentence-initial "Additionally," / "Furthermore,"',
    test: /(?:^|[.;]\s+)(?:additionally|furthermore|moreover|overall),/i,
  },
  {
    id: "avoided-x",
    tag: "Avoided X / Aimed to X / Focused on X",
    tier: "moderate",
    description: '"avoided…", "aimed to…", "focused on…"',
    test: /\b(?:avoid(?:ed|ing)|aim(?:ed|ing|s)? to|focus(?:ed|ing)? on)\b/i,
  },
];

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
    test: /(?:fuck(?:s|ed|er|ers|ing|in)?|shit(?:s|ty|ting)?|bullshit|damn(?:ed|it)?|crap(?:py)?|stupid|idiot(?:s|ic)?|moron(?:s|ic)?|dumb(?:ass)?|wtf|retard(?:s|ed)?|bitch(?:es|ing)?|asshole|sucks)|[!?]{2,}/i,
  },
  {
    id: "shouting",
    tier: "moderate",
    description: "ALL CAPS shouting (three or more capitalised words in a row)",
    test: /[A-Z]{4,}(?:\s+[A-Z]{3,}){2,}/,
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
