/** Posts flagged edits to a Discord webhook, one at a time, honouring rate limits. */
import { ButtonStyleTypes, MessageComponentTypes } from "discord-interactions";

export interface Embed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export interface LinkButton {
  label: string;
  url: string;
}

export interface Message {
  embeds: Embed[];
  buttons?: LinkButton[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Escape Discord Markdown in user-supplied text. A lone "~" is left alone:
 * "\~" at the start of link text (temporary accounts are "~2026-…") stops
 * Discord from parsing the whole field's links. Only "~~" is strikethrough.
 */
export function escapeMarkdown(s: string) {
  return s.replace(/([\\*_`|>\[\]()])/g, "\\$1").replace(/~~/g, "~\u200b~");
}

export class Webhook {
  private queue: Promise<void> = Promise.resolve();
  /** Link buttons need `with_components`; turned off if Discord refuses them. */
  private components = true;

  private readonly url: string;
  private readonly username: string;

  constructor(url: string, username = "AI edit summary watcher") {
    this.url = url;
    this.username = username;
  }

  /** Resolves once every queued message has been sent (or failed). */
  flush() {
    return this.queue;
  }

  send(message: Message): Promise<void> {
    const job = this.queue.then(() => this.post(message));
    this.queue = job.catch(() => {});
    return job;
  }

  private async post(message: Message) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const useComponents = this.components && !!message.buttons?.length;
      const body: Record<string, unknown> = {
        username: this.username,
        embeds: message.embeds,
        allowed_mentions: { parse: [] },
      };
      if (useComponents) {
        body.components = [
          {
            type: MessageComponentTypes.ACTION_ROW,
            components: message.buttons!.slice(0, 5).map((b) => ({
              type: MessageComponentTypes.BUTTON,
              style: ButtonStyleTypes.LINK,
              label: b.label.slice(0, 80),
              url: b.url,
            })),
          },
        ];
      }
      const url = new URL(this.url);
      url.searchParams.set("wait", "true");
      if (useComponents) url.searchParams.set("with_components", "true");

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      const text = await res.text();
      if (res.status === 429) {
        const retry = Number(JSON.parse(text || "{}").retry_after) || Number(res.headers.get("retry-after")) || 2;
        await sleep(retry * 1000 + 250);
        continue;
      }
      if (res.status === 400 && useComponents && /component/i.test(text)) {
        console.warn("Discord refused link buttons; sending links in the embed only.");
        this.components = false;
        continue;
      }
      if (res.status >= 500) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Discord webhook failed: HTTP ${res.status} ${text}`);
    }
    throw new Error("Discord webhook failed after retries");
  }
}
