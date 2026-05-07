import { requestUrl } from "obsidian";
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
    const ogDescription = this.htmlDoc
      .querySelector("meta[property='og:description']")
      ?.getAttribute("content");
    if (ogDescription) return ogDescription;

    const metaDescription = this.htmlDoc
      .querySelector("meta[name='description']")
      ?.getAttribute("content");
    if (metaDescription) return metaDescription;

    return undefined;
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
        const content = JSON.parse(script.textContent || "{}");
        // JSON-LD can be a single object or an array of objects (@graph)
        if (Array.isArray(content)) return content[0];
        if (content["@graph"] && Array.isArray(content["@graph"])) return content["@graph"][0];
        return content;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  private async getImage(): Promise<string | undefined> {
    const url = this.findImageUrl();
    if (!url) return undefined;

    // Use image-specific headers that CDNs expect from <img> tag requests
    const imageHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      "Referer": new URL(this.url).origin + "/",
    };

    try {
      const res = await requestUrl({ url, method: "HEAD", headers: imageHeaders });
      const contentType = res.headers?.["content-type"] ?? "";
      if (res.status >= 200 && res.status < 400 && contentType.startsWith("image/")) {
        return url;
      }
    } catch { /* HEAD blocked, try GET */ }

    try {
      const res = await requestUrl({ url, method: "GET", headers: imageHeaders });
      const contentType = res.headers?.["content-type"] ?? "";
      if (res.status >= 200 && res.status < 400 && contentType.startsWith("image/")) {
        return url;
      }
    } catch { /* both failed */ }

    return undefined;
  }

  private findImageUrl(): string | undefined {
    // 1. Try JSON-LD first (Best for Printables/Amazon)
    const jsonLd = this.getJsonLdData() as Record<string, unknown> | undefined;
    if (jsonLd) {
      const img = jsonLd.image as string | string[] | { url: string; } | undefined;
      if (Array.isArray(img) && img.length > 0) return this.resolveUrl(img[0]!);
      if (typeof img === 'string') return this.resolveUrl(img);
      if (img && typeof img === 'object' && 'url' in img) return this.resolveUrl((img as { url: string; }).url);
    }

    // 2. Fallback to standard meta tags
    const metaSelectors = [
      "meta[property='og:image']",
      "meta[name='twitter:image']",
      "meta[itemprop='image']",
      "link[rel='image_src']",
      "#landingImage",
      "#imgBlkFront",
      "#main-image",
      ".printable-image"
    ];

    for (const selector of metaSelectors) {
      const url = this.htmlDoc.querySelector(selector)?.getAttribute("content");
      if (url) return this.resolveUrl(url);
    }

    // 3. Fallback to site-specific IDs (Amazon/Printables legacy)
    const idSelectors = ["#landingImage", "#imgBlkFront", ".printable-image"];
    for (const selector of idSelectors) {
      const url = this.htmlDoc.querySelector(selector)?.getAttribute("src");
      if (url) return this.resolveUrl(url);
    }

    return undefined;
  }

  // Replace fixImageUrl with a simpler resolver that trusts the URL
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

  static sanitizeText(text: string | undefined): string | undefined {
    if (!text) return undefined;
    return text
      .replace(/\r\n|\n|\r/g, " ")  // newlines → space (safer than stripping)
      .replace(/\\/g, "\\\\")        // escape backslashes first
      .replace(/"/g, '\\"')          // escape double quotes
      .trim();
  }
}
