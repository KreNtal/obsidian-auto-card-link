import { LinkMetadata } from "./interfaces";

export class LinkMetadataParser {
  url: string;
  htmlDoc: Document;

  constructor(url: string, htmlText: string) {
    this.url = url;

    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(htmlText, "text/html");
    this.htmlDoc = htmlDoc;
  }

  async parse(): Promise<LinkMetadata | undefined> {
    // Titles get a longer cap than descriptions: a product page's title carries the
    // category tail ("... : Amazon.it: Elettronica") that the 160 default cut off, and an
    // inline markdown link shows the title in full where a card clamps it in CSS.
    const title = LinkMetadataParser.sanitizeText(this.getTitle(), 300);
    if (!title) return;
    const description = LinkMetadataParser.sanitizeText(this.getDescription());
    const { hostname } = new URL(this.url);
    const favicon = await this.getFavicon();
    const image = await this.getImage();

    return {
      url: this.url,
      title: title,
      description: description,
      host: hostname,
      siteName: this.getSiteName(),
      favicon: favicon,
      image: image,
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
      this.htmlDoc.querySelector(`meta[name='${property}']`)?.getAttribute("content");
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

  private getTitle(): string | undefined {
    // 1. Try OpenGraph Title
    const ogTitle = this.ogContent("og:title");
    if (ogTitle) return ogTitle;

    // 2. Try Twitter Title fallback
    const twitterTitle = this.htmlDoc
      .querySelector("meta[name='twitter:title']")
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
    const raw =
      this.ogContent("og:description") ??
      this.htmlDoc.querySelector("meta[name='description']")?.getAttribute("content");

    if (!raw) return undefined;

    // Parse as HTML to strip inline tags and decode entities — avoids innerHTML on a live node.
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    const text = (parsed.body.textContent ?? "").replace(/\s+/g, " ").trim();
    return text || undefined;
  }

  private async getFavicon(): Promise<string | undefined> {
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
    const { origin } = new URL(this.url);
    return `${origin}/favicon.ico`;
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
      const { origin } = new URL(this.url);
      return `${origin}${url}`;
    }
    const base = this.url.replace(/\/[^/]*$/, "/");
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
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .trim();
    if (result.length > maxLength) result = result.slice(0, maxLength).trimEnd() + "...";
    return result;
  }
}
