/**
 * Excludes edits made with semi-automated tools, using the patterns XTools
 * maintains at https://meta.wikimedia.org/wiki/MediaWiki:XTools-AutoEdits.json
 *
 * For a wiki like en.wikipedia.org the tool definitions from "global", "en"
 * and "en.wikipedia.org" are merged (later keys override earlier ones per tool).
 * An edit is excluded if its summary matches a tool's `regex` (or `revert`
 * regex), or it carries one of the tool's `tags`, unless it also carries
 * one of the tool's `tag_excludes`.
 */

const SOURCE = "https://meta.wikimedia.org/w/index.php?title=MediaWiki:XTools-AutoEdits.json&action=raw";

interface ToolDef {
  regex?: string;
  revert?: string | boolean;
  tags?: string[];
  tag?: string;
  tag_excludes?: string[];
}

interface Tool {
  name: string;
  patterns: RegExp[];
  tags: Set<string>;
  tagExcludes: Set<string>;
}

export class AutoEdits {
  private tools: Tool[] = [];

  get size() {
    return this.tools.length;
  }

  async load(domain: string, userAgent: string) {
    const res = await fetch(SOURCE, { headers: { "User-Agent": userAgent } });
    if (!res.ok) throw new Error(`Fetching AutoEdits JSON failed: HTTP ${res.status}`);
    this.setDefinitions(await res.json(), domain);
  }

  setDefinitions(json: Record<string, Record<string, ToolDef>>, domain: string) {
    const lang = domain.split(".")[0];
    const merged = new Map<string, ToolDef>();
    for (const key of ["global", lang, domain]) {
      for (const [name, def] of Object.entries(json[key] ?? {})) merged.set(name, { ...merged.get(name), ...def });
    }
    const tools: Tool[] = [];
    for (const [name, def] of merged) {
      const patterns: RegExp[] = [];
      for (const src of [def.regex, typeof def.revert === "string" ? def.revert : undefined]) {
        if (!src) continue;
        try {
          patterns.push(new RegExp(src));
        } catch (err) {
          console.warn(`AutoEdits: skipping invalid regex for ${name}: ${(err as Error).message}`);
        }
      }
      const tags = new Set([...(def.tags ?? []), ...(def.tag ? [def.tag] : [])]);
      if (patterns.length || tags.size) tools.push({ name, patterns, tags, tagExcludes: new Set(def.tag_excludes) });
    }
    this.tools = tools;
  }

  /** Name of the first tool the edit matches, or undefined. */
  match(comment: string, tags: string[] = []): string | undefined {
    for (const t of this.tools) {
      if (tags.some((tag) => t.tagExcludes.has(tag))) continue;
      if (tags.some((tag) => t.tags.has(tag)) || t.patterns.some((re) => re.test(comment))) return t.name;
    }
    return undefined;
  }
}
