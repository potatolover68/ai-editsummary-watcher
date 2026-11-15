/** Minimal MediaWiki Action API client with bot-password login and a cookie jar. */

type Params = Record<string, string | number | boolean | undefined>;

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, info: string) {
    super(`${code}: ${info}`);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Wiki {
  private cookies = new Map<string, string>();
  private credentials?: { user: string; password: string };

  readonly domain: string;
  private readonly userAgent: string;

  constructor(domain: string, userAgent: string) {
    this.domain = domain;
    this.userAgent = userAgent;
  }

  get api() {
    return `https://${this.domain}/w/api.php`;
  }

  /** Call the API, retrying on maxlag, HTTP 429/5xx and expired sessions. */
  async request(params: Params, method: "GET" | "POST" = "GET"): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const body = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5" });
      if (this.credentials && params.action !== "login") body.set("assert", "user");
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== false) body.set(k, String(v));

      const headers: Record<string, string> = { "User-Agent": this.userAgent, "Api-User-Agent": this.userAgent };
      if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");

      let res: Response;
      try {
        res =
          method === "POST"
            ? await fetch(this.api, { method, headers, body })
            : await fetch(`${this.api}?${body}`, { headers });
      } catch (err) {
        if (attempt >= 5) throw err;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }

      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 5) throw new Error(`HTTP ${res.status} from ${this.domain}`);
        await sleep(Math.max(retryAfter * 1000, 5000 * 2 ** attempt));
        continue;
      }
      const data: any = await res.json();
      if (data.error) {
        if (data.error.code === "maxlag" && attempt < 10) {
          await sleep(Math.max(retryAfter, 5) * 1000);
          continue;
        }
        if (data.error.code === "assertuserfailed" && this.credentials && attempt < 2) {
          console.warn("Session expired; logging in again.");
          await this.login(this.credentials.user, this.credentials.password);
          continue;
        }
        throw new ApiError(data.error.code, data.error.info);
      }
      return data;
    }
  }

  async login(user: string, password: string) {
    this.credentials = undefined;
    this.cookies.clear();
    const { query } = await this.request({ action: "query", meta: "tokens", type: "login" });
    const { login } = await this.request(
      { action: "login", lgname: user, lgpassword: password, lgtoken: query.tokens.logintoken },
      "POST",
    );
    if (login.result !== "Success") throw new Error(`Login failed: ${login.result} ${login.reason ?? ""}`);
    this.credentials = { user, password };
    return login.lgusername as string;
  }

  /** Every page of a query, following `continue`. */
  async *queryAll(params: Params): AsyncGenerator<any> {
    let cont: Record<string, string> = {};
    while (true) {
      const data = await this.request({ action: "query", ...params, ...cont });
      yield data;
      if (!data.continue) return;
      cont = data.continue;
    }
  }

  url(page: string, query?: Record<string, string | number>) {
    if (query) return `https://${this.domain}/w/index.php?${new URLSearchParams({ title: page, ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) })}`;
    return `https://${this.domain}/wiki/${encodeTitle(page)}`;
  }
}

/** Encode a page title for a URL, also escaping characters that break Markdown links. */
export function encodeTitle(title: string) {
  return encodeURIComponent(title.replace(/ /g, "_"))
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/[()'*!]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
