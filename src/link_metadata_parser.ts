import { LinkMetadata } from "src/interfaces";

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
    const ogTitle = this.htmlDoc
      .querySelector("meta[property='og:title']")
      ?.getAttribute("content");
    if (ogTitle) return ogTitle;

    const title = this.htmlDoc.querySelector("title")?.textContent;
    if (title) return title;

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

  private async getImage(): Promise<string | undefined> {
    const ogImage = this.htmlDoc
      .querySelector("meta[property='og:image']")
      ?.getAttribute("content");
    if (ogImage) return this.resolveUrl(ogImage);

    // Also try twitter:image as fallback
    const twitterImage = this.htmlDoc
      .querySelector("meta[name='twitter:image'], meta[property='twitter:image']")
      ?.getAttribute("content");
    if (twitterImage) return this.resolveUrl(twitterImage);

    return undefined;
  }

  // Replace fixImageUrl with a simpler resolver that trusts the URL
  private resolveUrl(url: string): string {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) {
      const { origin } = new URL(this.url);
      return `${origin}${url}`;
    }
    // relative path
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
