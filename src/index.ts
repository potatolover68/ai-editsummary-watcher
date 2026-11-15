/**
 * Watches recent changes on a wiki (all namespaces), scores each edit summary
 * with the ai-editsummary-model, and posts edits scoring above THRESHOLD to a
 * Discord webhook. Edits made with tools listed in XTools' AutoEdits JSON are
 * skipped.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AutoEdits } from "./autoedits.ts";
import { analyze } from "./heuristics/index.ts";
import { escapeMarkdown, Webhook, type Message } from "./discord.ts";
import { Model, normalize } from "./model.ts";
import { encodeTitle, Wiki } from "./wiki.ts";

const ROOT = join(import.meta.dirname, "..");
const VERSION: string = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return v;
}

const config = {
  webhook: env("DISCORD_WEBHOOK"),
  botUser: env("BOTUSER"),
  botPassword: env("BOTPASSWORD"),
  hostname: process.env.HOSTNAME,
  domain: env("WIKI", "en.wikipedia.org"),
  threshold: Number(env("THRESHOLD", "0.9")),
  pollSeconds: Number(env("POLL_SECONDS", "15")),
  backfillMinutes: Number(env("BACKFILL_MINUTES", "0")),
  modelPath: join(ROOT, env("MODEL_PATH", "model.onnx")),
  dryRun: /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? ""),
  /** Skip summaries the heuristics call obviously human (HEURISTICS=0 to disable). */
  useHeuristics: !/^(0|false|no)$/i.test(process.env.HEURISTICS ?? ""),
};

/** Pages whose edit summaries are written by a tool rather than the editor. */
const TOOL_PAGES = /\/TWA\//; // The Wikipedia Adventure tutorial

const botName = config.botUser.split("@")[0];
const USER_AGENT = `ai-editsummary-watcher/${VERSION} (https://${config.domain}/wiki/User:${encodeTitle(botName)}) Node.js/${process.version}`;

interface RecentChange {
  type: "edit" | "new";
  ns: number;
  title: string;
  rcid: number;
  revid: number;
  old_revid: number;
  oldlen: number;
  newlen: number;
  user?: string;
  userhidden?: boolean;
  anon?: boolean;
  temp?: boolean;
  comment?: string;
  commenthidden?: boolean;
  timestamp: string;
  tags?: string[];
  minor?: boolean;
}

interface UserInfo {
  name: string;
  editcount?: number;
  registration?: string | null;
  invalid?: boolean;
  missing?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`].filter(Boolean).join(" ");
}

function codeBlock(s: string) {
  return "```\n" + s.replace(/`/g, "`​") + "\n```";
}

/** Change tags that point at AI-generated or pasted content; shown in bold. */
const AI_TAGS = new Set(
  [
    "possible formatting issues",
    "editcheck-llm-paste-shown",
    "editcheck-llm-paste",
    "editcheck-paste-shown",
    "possible AI-generated citations",
  ].map((t) => t.toLowerCase()),
);

function formatTags(tags: string[]) {
  if (!tags.length) return "none";
  return tags
    .map((t) => (AI_TAGS.has(t.toLowerCase()) ? `**${escapeMarkdown(t)}**` : escapeMarkdown(t)))
    .join(", ")
    .slice(0, 1024);
}

function buildMessage(wiki: Wiki, rc: RecentChange, score: number, user: UserInfo | undefined): Message {
  const name = rc.user ?? "(hidden)";
  const diff =
    rc.type === "new" ? wiki.url(rc.title, { oldid: rc.revid }) : wiki.url(rc.title, { diff: rc.revid, oldid: rc.old_revid });
  const links = {
    user: wiki.url(`User:${name}`),
    talk: wiki.url(`User talk:${name}`),
    contribs: wiki.url(`Special:Contributions/${name}`),
  };
  const delta = rc.newlen - (rc.oldlen ?? 0);
  const t = unix(rc.timestamp);

  const ip = rc.anon || user?.invalid;
  const editCount = ip ? "n/a (IP)" : user?.editcount !== undefined ? user.editcount.toLocaleString("en-US") : "unknown";
  const registered = ip
    ? "n/a (IP)"
    : user?.registration
      ? `<t:${unix(user.registration)}:D> (<t:${unix(user.registration)}:R>)`
      : "unknown (before 2005?)";
  const footer = [`ai-editsummary-watcher v${VERSION}`, `uptime ${formatUptime(process.uptime())}`];
  if (config.hostname) footer.push(`host ${config.hostname}`);

  return {
    embeds: [
      {
        title: `${rc.type === "new" ? "New page: " : ""}${rc.title}`.slice(0, 256),
        url: diff,
        description: codeBlock(rc.comment ?? ""),
        color: score >= 0.97 ? 0xd32f2f : 0xf57c00,
        timestamp: rc.timestamp,
        fields: [
          { name: "AI score", value: score.toFixed(3), inline: true },
          {
            name: "Size",
            value: `${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")} bytes (now ${rc.newlen.toLocaleString("en-US")})${rc.minor ? " · minor" : ""}`,
            inline: true,
          },
          { name: "Made", value: `<t:${t}:f> (<t:${t}:R>)`, inline: true },
          {
            name: "Performer",
            value: `[${escapeMarkdown(name)}](${links.user}) · [talk](${links.talk}) · [contribs](${links.contribs})`,
          },
          { name: "Edit count", value: editCount, inline: true },
          { name: "Registered", value: registered, inline: true },
          { name: "Tags", value: formatTags(rc.tags ?? []) },
        ],
        footer: { text: footer.join(" · ") },
      },
    ],
    buttons: [
      { label: "Diff", url: diff },
      { label: "User page", url: links.user },
      { label: "Talk", url: links.talk },
      { label: "Contribs", url: links.contribs },
    ],
  };
}

async function fetchUsers(wiki: Wiki, names: string[]) {
  const out = new Map<string, UserInfo>();
  for (let i = 0; i < names.length; i += 50) {
    const data = await wiki.request({
      action: "query",
      list: "users",
      ususers: names.slice(i, i + 50).join("|"),
      usprop: "editcount|registration",
    });
    for (const u of data.query.users as UserInfo[]) out.set(u.name, u);
  }
  return out;
}

async function main() {
  console.log(`ai-editsummary-watcher v${VERSION} on ${config.domain}, threshold > ${config.threshold}${config.dryRun ? " (dry run)" : ""}`);
  const wiki = new Wiki(config.domain, USER_AGENT);
  const [model, loggedInAs] = await Promise.all([Model.load(config.modelPath), wiki.login(config.botUser, config.botPassword)]);
  console.log(`Logged in as ${loggedInAs}; model loaded from ${config.modelPath}`);

  const autoEdits = new AutoEdits();
  await autoEdits.load(config.domain, USER_AGENT);
  console.log(`Loaded ${autoEdits.size} AutoEdits tool definitions`);
  setInterval(
    () => autoEdits.load(config.domain, USER_AGENT).catch((e) => console.warn("AutoEdits refresh failed:", e.message)),
    6 * 3600e3,
  ).unref();

  const webhook = new Webhook(config.webhook);
  const seen = new Map<number, number>(); // rcid -> when seen
  const stats = { edits: 0, excluded: 0, obviouslyHuman: 0, scored: 0, flagged: 0 };
  let cursor = Date.now() - config.backfillMinutes * 60e3;
  let running = true;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (running = false));
  setInterval(() => console.log(`[stats] ${JSON.stringify(stats)} uptime ${formatUptime(process.uptime())}`), 600e3).unref();

  while (running) {
    const started = Date.now();
    try {
      const fresh: RecentChange[] = [];
      // Overlap two minutes with the previous poll: rows can be committed slightly out of order.
      const rcstart = new Date(cursor - 120e3).toISOString().replace(/\.\d+Z$/, "Z");
      for await (const page of wiki.queryAll({
        list: "recentchanges",
        rcdir: "newer",
        rcstart,
        rctype: "edit|new",
        rcshow: "!bot",
        rcprop: "title|ids|sizes|flags|user|comment|timestamp|tags",
        rclimit: "max",
      })) {
        for (const rc of page.query.recentchanges as RecentChange[]) {
          if (seen.has(rc.rcid)) continue;
          seen.set(rc.rcid, Date.now());
          fresh.push(rc);
          cursor = Math.max(cursor, Date.parse(rc.timestamp));
        }
      }
      for (const [id, when] of seen) if (Date.now() - when > 15 * 60e3) seen.delete(id);

      const candidates: RecentChange[] = [];
      for (const rc of fresh) {
        stats.edits++;
        if (rc.commenthidden || rc.userhidden || !rc.comment || !normalize(rc.comment)) continue;
        if (autoEdits.match(rc.comment, rc.tags) || TOOL_PAGES.test(rc.title)) {
          stats.excluded++;
          continue;
        }
        // Anti-AI heuristics: skip summaries that are obviously human, tool or software written.
        if (config.useHeuristics && analyze(rc.comment).verdict === "human") {
          stats.obviouslyHuman++;
          continue;
        }
        candidates.push(rc);
      }

      const scores = await model.score(candidates.map((rc) => rc.comment!));
      stats.scored += candidates.length;
      const hits = candidates.map((rc, i) => ({ rc, score: scores[i] })).filter((h) => h.score > config.threshold);

      if (hits.length) {
        const users = await fetchUsers(wiki, [...new Set(hits.map((h) => h.rc.user!).filter(Boolean))]);
        for (const { rc, score } of hits) {
          stats.flagged++;
          console.log(`[flag] ${score.toFixed(3)} ${rc.title} by ${rc.user}: ${rc.comment}`);
          const msg = buildMessage(wiki, rc, score, users.get(rc.user!));
          if (config.dryRun) console.log(JSON.stringify(msg));
          else webhook.send(msg).catch((e) => console.error("Webhook error:", e.message));
        }
      }
    } catch (err) {
      console.error("Poll failed:", (err as Error).message);
    }
    const wait = config.pollSeconds * 1000 - (Date.now() - started);
    for (let t = 0; running && t < wait; t += 500) await sleep(500);
  }
  console.log("Stopping.", JSON.stringify(stats));
  await webhook.flush();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
