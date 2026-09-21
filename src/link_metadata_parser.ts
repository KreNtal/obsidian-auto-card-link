import { LinkMetadata } from "./interfaces";

export class LinkMetadataParser {
  url: string;
  htmlDoc: Document;

  constructor(url: string, htmlText: string) {
    this.url = url;

    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(htmlText, "text/html");
    this.htmlDoc = htmlDoc;
    this.base = this.declaredBase() ?? url;
  }

  /** What relative favicon and image paths resolve against - see declaredBase. */
  private base: string;

  /**
   * The address the page says it is at, when that is on another host than the URL we asked
   * for: we were redirected, and requestUrl does not tell us where to. A DOI lands on the
   * publisher, and Nature's `/oscar-static/…` favicon came out on doi.org, a 404 (2026-09-18).
   * `<base href>` first, since relative URLs are resolved against it by definition, then
   * `og:url`, then the canonical link. On the same host nothing changes.
   */
  private declaredBase(): string | undefined {
    const declared = [
      this.htmlDoc.querySelector("base[href]")?.getAttribute("href"),
      this.ogContent("og:url"),
      this.htmlDoc.querySelector("link[rel='canonical']")?.getAttribute("href"),
    ];
    for (const href of declared) {
      if (!href) continue;
      try {
        const resolved = new URL(href, this.url);
        if (/^https?:$/.test(resolved.protocol) && resolved.hostname !== new URL(this.url).hostname) return resolved.href;
      } catch { /* not a URL */ }
    }
    return undefined;
  }

  async parse(): Promise<LinkMetadata | undefined> {
    // Titles get a longer cap than descriptions: a product page's title carries the
    // category tail ("... : Amazon.it: Elettronica") that the 160 default cut off, and an
    // inline markdown link shows the title in full where a card clamps it in CSS.
    const title = LinkMetadataParser.sanitizeText(
      LinkMetadataParser.trimTrailingSeparator(this.getTitle()), 300);
    if (!title) return;
    const description = LinkMetadataParser.sanitizeText(this.getDescription());
    const { hostname } = new URL(this.url);
    const favicon = await this.getFavicon();
    const image = await this.getImage();
    const siteName = this.getSiteName();

    return {
      url: this.url,
      title: title,
      author: this.getAuthor(siteName, hostname),
      description: description,
      host: hostname,
      siteName: siteName,
      favicon: favicon,
      image: image,
      duration: this.getDuration(),
      indent: 0,
    };
  }

  /**
   * The site's own display name, with its own capitalisation ("YouTube", "IMDb").
   * Only used for inline markdown links, where the host isn't shown separately.
   */
  /**
   * An OpenGraph tag is `<meta property="og:…">`, but writing `name=` instead is a common
   * enough mistake that entire sites ship it - developer.mozilla.org declares all nine of its
   * og tags that way, so every one of them was invisible here and MDN pages fell back to
   * `<title>` and the plain meta description. `property` is tried first, so a page declaring
   * both keeps the conformant one and nothing that worked before changes. `getImage()` already
   * special-cased `meta[name='og:image']`; this is the same allowance for the rest.
   */
  private ogContent(property: string): string | undefined {
    const value =
      this.htmlDoc.querySelector(`meta[property='${property}']`)?.getAttribute("content") ??
      this.htmlDoc.querySelector(`meta[name='${property}' i]`)?.getAttribute("content");
    return value?.trim() || undefined;
  }

  private getSiteName(): string | undefined {
    const raw = this.ogContent("og:site_name");
    if (!raw) return undefined;

    // Sites routinely append a tagline ("Thingiverse - The community for Open Hardware");
    // the name itself is the first segment. Anything still long after that isn't a name.
    const name = raw.split(/\s+[-|\u2013\u2014:\u00b7]\s+/)[0]?.trim();
    if (!name || name.length > 40) return undefined;
    return LinkMetadataParser.sanitizeText(name);
  }

  /**
   * Drops a separator left dangling at the end of a title.
   *
   * A site that splits its own heading across og:title and og:description cuts at the
   * punctuation and keeps it: Medium publishes “Pandas v Psycopg:” with “A Postgres database
   * speed test. Who wins?” as the description, so the card ended on a colon that leads
   * nowhere. No real title ends in a separator, so this is safe to do for every site - and
   * only for separators, never for “...”, “?” or “!”, which are part of a title.
   */
  private static trimTrailingSeparator(title: string | undefined): string | undefined {
    const trimmed = title?.replace(/\s*[-|:·•–—]+\s*$/, "").trim();
    // A title that was nothing but punctuation is left alone: emptying it here would turn a
    // parse that succeeded into one that failed.
    return trimmed || title;
  }

  private getTitle(): string | undefined {
    // 1. Try OpenGraph Title
    const ogTitle = this.ogContent("og:title");
    if (ogTitle) return ogTitle;

    // 2. Try Twitter Title fallback
    const twitterTitle = this.htmlDoc
      .querySelector("meta[name='twitter:title' i]")
      ?.getAttribute("content");
    if (twitterTitle && twitterTitle.trim().length > 0) return twitterTitle.trim();

    // 3. Try Standard HTML Title
    const title = this.htmlDoc.querySelector("title")?.textContent;
    if (title && title.trim().length > 0) return title.trim();

    // 4. Last resort: The first H1 tag 
    // (Common in simple HTML pages or articles)
    const h1 = this.htmlDoc.querySelector("h1")?.textContent;
    if (h1 && h1.trim().length > 0) return h1.trim();

    return undefined;
  }

  private getDescription(): string | undefined {
    // Every `meta[name=…]` lookup here matches case-insensitively (the ` i` flag): a `name`
    // value is compared exactly otherwise, and pkg.go.dev declares `name="Description"`, so its
    // package pages lost their description while its 404 page, written in lower case, kept one.
    const raw =
      this.ogContent("og:description") ??
      this.htmlDoc.querySelector("meta[name='description' i]")?.getAttribute("content");

    if (!raw) return undefined;

    // Parse as HTML to strip inline tags and decode entities — avoids innerHTML on a live node.
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    const text = (parsed.body.textContent ?? "").replace(/\s+/g, " ").trim();
    return text || undefined;
  }

  private async getFavicon(): Promise<string | undefined> {
    // An SVG icon first, when the page declares one: Chromium picks it for the tab bar too, it
    // scales to the card's 16px, and a declared .ico can be one Chromium will not draw - Linear's
    // 64px favicon-*.ico decodes fully transparent in Obsidian, while the SVG beside it renders
    // (measured in the console, 2026-09-18).
    const svg = Array.from(this.htmlDoc.querySelectorAll("link[rel='icon']")).find((l) =>
      l.getAttribute("type") === "image/svg+xml" || /\.svg([?#]|$)/i.test(l.getAttribute("href") ?? ""));
    const svgHref = svg?.getAttribute("href");
    if (svgHref) return this.resolveUrl(svgHref);

    // Try all common favicon link rel variants in order
    const selectors = [
      "link[rel='icon']",
      "link[rel='shortcut icon']",
      "link[rel='apple-touch-icon']",
      "link[rel='apple-touch-icon-precomposed']",
    ];

    for (const selector of selectors) {
      const href = this.htmlDoc.querySelector(selector)?.getAttribute("href");
      if (href) return this.resolveUrl(href);
    }

    // Fallback: /favicon.ico always exists on well-behaved sites
    const { origin } = new URL(this.base);
    return `${origin}/favicon.ico`;
  }

  private getAuthor(siteName: string | undefined, host: string): string | undefined {
    return LinkMetadataParser.pickAuthor(
      [
        this.htmlDoc.querySelector("meta[name='author' i]")?.getAttribute("content"),
        this.ogContent("article:author"),
      ],
      Array.from(this.htmlDoc.querySelectorAll("script[type='application/ld+json']"), (s) => s.textContent ?? ""),
      siteName,
      host,
      Array.from(this.htmlDoc.querySelectorAll("meta[name='citation_author' i]"), (m) => m.getAttribute("content") ?? ""),
    );
  }

  /**
   * The byline a page declares (field rule F1), in order: `<meta name="author">`,
   * `article:author`, then JSON-LD, then `citation_author` - the Highwire tags Google Scholar
   * reads, one per author, which is often the only byline an academic page declares (bioRxiv,
   * Zenodo, 2026-09-18). Last, so nothing that already had an author changes. Measured 2026-09-16 on 38 pages: news and blogs declare
   * one (Medium, The Verge, Wired, TechCrunch, GitHub Blog in a meta tag; BBC, Guardian, Ars
   * Technica, Repubblica, Quanta, Substack only in JSON-LD), catalogues and databases do not.
   *
   * What is discarded, each seen on a real page:
   * - a URL, from any source - `article:author` is usually a profile link (Guardian, Medium,
   *   Smashing) and on BBC the Facebook page;
   * - the site itself - Codeberg's organisation pages declare `author` "Codeberg";
   * - JSON-LD below the top level - Apple Podcasts' only `author` belongs to a listener's
   *   review nested inside the show.
   *
   * Several authors read as arXiv's already do: "A and B", then "A et al." - Goodreads lists
   * a book's editors and illustrators after its writer.
   */
  static pickAuthor(
    metaValues: (string | null | undefined)[], jsonLdTexts: string[], siteName: string | undefined, host: string,
    citationAuthors: string[] = []
  ): string | undefined {
    const squash = (s: string) => s.toLowerCase().replace(/\.[a-z]{2,}$/, "").replace(/[^\p{L}\p{N}]/gu, "");
    const site = [siteName, host.replace(/^www\./, "")].filter((s): s is string => !!s).map(squash);
    const usable = (name: unknown): name is string =>
      typeof name === "string" && !!name.trim()
      && !/^(https?:)?\/\/|^www\./i.test(name.trim())
      && !site.includes(squash(name));
    const join = (names: string[]) => names.length <= 2 ? names.join(" and ") : `${names[0]!} et al.`;

    for (const value of metaValues) {
      if (usable(value)) return LinkMetadataParser.sanitizeText(value.trim());
    }

    for (const text of jsonLdTexts) {
      let content: unknown;
      try { content = JSON.parse(text); } catch { continue; }
      const top: unknown[] = Array.isArray(content) ? (content as unknown[]) : [content];
      const graph = top.flatMap((node): unknown[] => {
        const inner = (node as { "@graph"?: unknown; } | null)?.["@graph"];
        return Array.isArray(inner) ? (inner as unknown[]) : [node];
      });
      for (const node of graph) {
        const author = (node as { author?: unknown; } | null)?.author;
        if (!author) continue;
        const names = (Array.isArray(author) ? author : [author])
          .map((a) => typeof a === "string" ? a : (a as { name?: unknown; } | null)?.name)
          .filter(usable)
          .map((n) => n.trim());
        if (names.length) return LinkMetadataParser.sanitizeText(join(names));
      }
    }

    const cited = citationAuthors.filter(usable).map((n) => n.trim());
    return cited.length ? LinkMetadataParser.sanitizeText(join(cited)) : undefined;
  }

  /**
   * The length a video page declares, for every site - parsing, as F1 is for the author.
   * Until 2026-09-21 only a fetcher ever set a duration, so Odysee (`og:video:duration` 65,
   * JSON-LD "PT1M5S") and Nebula (`video:duration` 1130) cards had none. OpenGraph's
   * `video:duration` in seconds first, as its spec names it and Nebula writes it, then
   * `og:video:duration`, then a top-level JSON-LD `VideoObject`'s ISO 8601 `duration`.
   */
  private getDuration(): string | undefined {
    const seconds = Number(this.ogContent("video:duration") ?? this.ogContent("og:video:duration"));
    if (seconds > 0) return LinkMetadataParser.formatDuration(Math.round(seconds));

    for (const script of Array.from(this.htmlDoc.querySelectorAll("script[type='application/ld+json']"))) {
      let content: unknown;
      try { content = JSON.parse(script.textContent ?? ""); } catch { continue; }
      const top: unknown[] = Array.isArray(content) ? (content as unknown[]) : [content];
      for (const node of top.flatMap((n): unknown[] => {
        const inner = (n as { "@graph"?: unknown; } | null)?.["@graph"];
        return Array.isArray(inner) ? (inner as unknown[]) : [n];
      })) {
        const video = node as { "@type"?: unknown; duration?: unknown; } | null;
        if (video?.["@type"] !== "VideoObject" || typeof video.duration !== "string") continue;
        const iso = video.duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
        const total = iso ? Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Math.round(Number(iso[3] ?? 0)) : 0;
        if (total > 0) return LinkMetadataParser.formatDuration(total);
      }
    }
    return undefined;
  }

  /** "1:02:05", or "4:05" under an hour. */
  static formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  private getJsonLdData(): unknown {
    try {
      const scripts = this.htmlDoc.querySelectorAll("script[type='application/ld+json']");
      for (const script of Array.from(scripts)) {
        const content: unknown = JSON.parse(script.textContent || "{}");
        if (!content || typeof content !== "object") return null;
        // JSON-LD can be a single object or an array of objects (@graph)
        if (Array.isArray(content)) return (content as unknown[])[0];
        const obj = content as Record<string, unknown>;
        if (obj["@graph"] && Array.isArray(obj["@graph"])) return (obj["@graph"] as unknown[])[0];
        return obj;
      }
    } catch {
      return null;
    }
    return null;
  }

  private async getImage(): Promise<string | undefined> {
    // 1. JSON-LD image — trusted structured data (Printables, Amazon, schema.org sites).
    const jsonLdImage = this.findJsonLdImage();
    if (jsonLdImage && !LinkMetadataParser.isVideoUrl(jsonLdImage)) return jsonLdImage;

    // 2. og:/twitter:/itemprop meta tags — trusted. Some sites (e.g. cults3d) point
    //    og:image at a preview *video* (.mp4), which <img> can't render; a page can also
    //    declare several og:image tags, so we scan ALL of them and return the first that
    //    is not a video. No extra requests — they're already in the parsed HTML.
    for (const selector of [
      "meta[property='og:image:secure_url']",
      "meta[property='og:image']",
      "meta[name='og:image']",
      "meta[property='twitter:image']",
      "meta[name='twitter:image']",
      "meta[itemprop='image']",
    ]) {
      for (const el of Array.from(this.htmlDoc.querySelectorAll(selector))) {
        const content = el.getAttribute("content");
        if (!content) continue;
        const resolved = this.resolveUrl(content);
        if (!LinkMetadataParser.isVideoUrl(resolved)) return resolved;
      }
    }

    const linkImage = this.htmlDoc.querySelector("link[rel='image_src']")?.getAttribute("href");
    if (linkImage) {
      const resolved = this.resolveUrl(linkImage);
      if (!LinkMetadataParser.isVideoUrl(resolved)) return resolved;
    }

    // 3. Known site-specific selectors — probe with a short timeout.
    const domUrl = this.findDomImageUrl();
    if (domUrl && !LinkMetadataParser.isVideoUrl(domUrl)) {
      return this.checkImageWithBrowser(domUrl, 2000);
    }

    return undefined;
  }

  private static isVideoUrl(url: string): boolean {
    // Match a video file extension at the end of the path (before any query string).
    return /\.(mp4|webm|mov|m4v|ogv|avi|mkv)(\?|#|$)/i.test(url);
  }

  private findJsonLdImage(): string | undefined {
    const jsonLd = this.getJsonLdData() as Record<string, unknown> | null;
    if (!jsonLd) return undefined;

    // schema.org lets `image` be a URL, an ImageObject, or an array of either. Three of those
    // four shapes were handled; an array of ImageObjects - what The Verge publishes - fell
    // through to resolveUrl with the object itself, which threw and took the whole card down
    // with it, notice and all. Flatten first, then read a URL out of whichever shape arrived.
    const candidates = Array.isArray(jsonLd.image) ? (jsonLd.image as unknown[]) : [jsonLd.image];
    for (const candidate of candidates) {
      const url = LinkMetadataParser.jsonLdImageUrl(candidate);
      if (url) return this.resolveUrl(url);
    }
    return undefined;
  }

  private static jsonLdImageUrl(value: unknown): string | undefined {
    if (typeof value === "string") return value.trim() || undefined;
    if (value && typeof value === "object") {
      const url = (value as { url?: unknown; }).url;
      if (typeof url === "string") return url.trim() || undefined;
    }
    return undefined;
  }

  private findDomImageUrl(): string | undefined {
    const srcSelectors = ["#landingImage", "#imgBlkFront", "#main-image", ".printable-image"];
    for (const selector of srcSelectors) {
      const url = this.htmlDoc.querySelector(selector)?.getAttribute("src");
      if (url) return this.resolveUrl(url);
    }
    return undefined;
  }

  private checkImageWithBrowser(url: string, timeoutMs = 2000): Promise<string | undefined> {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => {
        img.src = "";
        resolve(undefined);
      }, timeoutMs);
      img.onload = () => { window.clearTimeout(timer); resolve(url); };
      img.onerror = () => { window.clearTimeout(timer); resolve(undefined); };
      img.src = url;
    });
  }

  private resolveUrl(url: string): string {
    // JSON-LD is untyped at runtime, so a caller can hand this anything a site chose to put
    // in a field: guard rather than throw and lose the card.
    if (!url || typeof url !== "string") return "";
    // A `content` read off a <meta> tag is normally entity-decoded by the DOM already, but a
    // doubly-encoded source (seen on TED's og:image) leaves a literal `&amp;` mid-URL, which
    // then breaks the query string. Decoding here is idempotent on a clean URL.
    url = url.replace(/&amp;/g, "&").trim();
    if (url.startsWith("http://")) url = "https://" + url.slice(7);
    if (url.startsWith("https://")) {
      // Collapse accidental double slashes, but only in the path - a `//` inside the query
      // string (a nested URL in a `?next=`/`?url=` parameter) is meaningful and left alone.
      const [head, ...rest] = url.split("?");
      const fixed = head!.replace(/([^:])\/\/+/g, "$1/");
      return rest.length ? `${fixed}?${rest.join("?")}` : fixed;
    }
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) {
      const { origin } = new URL(this.base);
      return `${origin}${url}`;
    }
    const base = this.base.replace(/\/[^/]*$/, "/");
    return `${base}${url}`;
  }

  /**
   * The default cap is generous on purpose: the card's own 3-line clamp (see styles.css) is
   * the real visual limit regardless of how much text this hands back, so a higher number
   * here never looks worse - it only decides how much slack a long description gets before
   * our own "..." kicks in instead of the CSS ellipsis. 300 is enough for most fetched
   * descriptions (Wikipedia extracts, Reddit self-text, ...) to actually fill those 3 lines
   * rather than being cut mid-sentence well before them.
   */
  static sanitizeText(text: string | undefined, maxLength = 300): string | undefined {
    if (!text) return undefined;
    let result = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\r\n|\n|\r/g, " ")
      // No quote or backslash escaping here: the card block's writer quotes every text field
      // itself (CodeBlockGenerator.yamlQuote), and escaping twice left literal backslashes in
      // the card - Yeggi's title `"benchy" 3D Models to Print - yeggi` rendered as
      // `\"benchy\" 3D Models…` (2026-09-21).
      .trim();
    if (result.length > maxLength) result = result.slice(0, maxLength).trimEnd() + "...";
    return result;
  }
}
