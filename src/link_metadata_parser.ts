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
    const raw =
      this.htmlDoc.querySelector("meta[property='og:description']")?.getAttribute("content") ??
      this.htmlDoc.querySelector("meta[name='description']")?.getAttribute("content");

    if (!raw) return undefined;

    const div = document.createElement("div");
    div.innerHTML = raw;
    const text = (div.textContent ?? "").replace(/\s+/g, " ").trim();
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
    // og:/twitter: meta tags are from the page author and almost always valid —
    // return them directly without a browser probe to avoid blocking card creation.
    const trustedImage =
      this.htmlDoc.querySelector("meta[property='og:image:secure_url']")?.getAttribute("content") ??
      this.htmlDoc.querySelector("meta[property='og:image']")?.getAttribute("content") ??
      this.htmlDoc.querySelector("meta[name='og:image']")?.getAttribute("content") ??
      this.htmlDoc.querySelector("meta[property='twitter:image']")?.getAttribute("content") ??
      this.htmlDoc.querySelector("meta[name='twitter:image']")?.getAttribute("content");

    if (trustedImage) return this.resolveUrl(trustedImage);

    // DOM-scraped fallback URLs are less reliable — probe with a short timeout
    const url = this.findImageUrl();
    if (!url) return undefined;
    return this.checkImageWithBrowser(url, 2000);
  }

  private checkImageWithBrowser(url: string, timeoutMs = 2000): Promise<string | undefined> {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => {
        img.src = "";
        resolve(undefined);
      }, timeoutMs);
      img.onload = () => { clearTimeout(timer); resolve(url); };
      img.onerror = () => { clearTimeout(timer); resolve(undefined); };
      img.src = url;
    });
  }

  private findImageUrl(): string | undefined {
    // 1. Try JSON-LD first (best for Printables/Amazon)
    const jsonLd = this.getJsonLdData() as Record<string, unknown> | undefined;
    if (jsonLd) {
      const img = jsonLd.image as string | string[] | { url: string; } | undefined;
      if (Array.isArray(img) && img.length > 0) return this.resolveUrl(img[0]!);
      if (typeof img === 'string') return this.resolveUrl(img);
      if (img && typeof img === 'object' && 'url' in img) return this.resolveUrl((img as { url: string; }).url);
    }

    // 2. Meta tags with content attribute
    const metaSelectors = [
      "meta[itemprop='image']",
      "link[rel='image_src']",
    ];

    for (const selector of metaSelectors) {
      const url = this.htmlDoc.querySelector(selector)?.getAttribute("content");
      if (url) return this.resolveUrl(url);
    }

    // 3. DOM elements with src attribute (Amazon, Printables, etc.)
    const srcSelectors = ["#landingImage", "#imgBlkFront", "#main-image", ".printable-image"];
    for (const selector of srcSelectors) {
      const url = this.htmlDoc.querySelector(selector)?.getAttribute("src");
      if (url) return this.resolveUrl(url);
    }

    return undefined;
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
