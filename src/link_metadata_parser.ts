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
    const title = LinkMetadataParser.sanitizeText(this.getTitle());
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
      favicon: favicon,
      image: image,
      indent: 0,
    };
  }

  private getTitle(): string | undefined {
    // 1. Try OpenGraph Title
    const ogTitle = this.htmlDoc
      .querySelector("meta[property='og:title']")
      ?.getAttribute("content");
    if (ogTitle && ogTitle.trim().length > 0) return ogTitle.trim();

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
      this.htmlDoc.querySelector("meta[property='og:description']")?.getAttribute("content") ??
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
    const img = jsonLd.image as string | string[] | { url: string; } | undefined;
    if (Array.isArray(img) && img.length > 0) return this.resolveUrl(img[0]!);
    if (typeof img === "string") return this.resolveUrl(img);
    if (img && typeof img === "object" && "url" in img) return this.resolveUrl(img.url);
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
    if (!url) return "";
    if (url.startsWith("http://")) url = url.replace("http://", "https://");
    if (url.startsWith("https://")) {
      // Fix double slashes in path (after the protocol)
      return url.replace(/([^:])\/\/+/g, "$1/");
    }
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) {
      const { origin } = new URL(this.url);
      return `${origin}${url}`;
    }
    const base = this.url.replace(/\/[^/]*$/, "/");
    return `${base}${url}`;
  }

  static sanitizeText(text: string | undefined, maxLength = 160): string | undefined {
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
