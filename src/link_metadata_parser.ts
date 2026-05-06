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
    const favicon = this.htmlDoc
      .querySelector("link[rel='icon']")
      ?.getAttribute("href");
    if (favicon) return await this.fixImageUrl(favicon);

    return undefined;
  }

  private async getImage(): Promise<string | undefined> {
    const ogImage = this.htmlDoc
      .querySelector("meta[property='og:image']")
      ?.getAttribute("content");
    if (ogImage) return await this.fixImageUrl(ogImage);

    return undefined;
  }

  private async fixImageUrl(url: string | undefined): Promise<string> {
    if (url === undefined) return "";
    const { hostname } = new URL(this.url);
    let image = url;
    // check if image url use double protocol
    if (url && url.startsWith("//")) {
      //   check if url can access via https or http
      const testUrlHttps = `https:${url}`;
      const testUrlHttp = `http:${url}`;
      if (await checkUrlAccessibility(testUrlHttps)) {
        image = testUrlHttps;
      } else if (await checkUrlAccessibility(testUrlHttp)) {
        image = testUrlHttp;
      }
    } else if (url && url.startsWith("/") && hostname) {
      //   check if image url is relative path
      const testUrlHttps = `https://${hostname}${url}`;
      const testUrlHttp = `http://${hostname}${url}`;
      const resUrlHttps = await checkUrlAccessibility(testUrlHttps);
      const resUrlHttp = await checkUrlAccessibility(testUrlHttp);
      //   check if url can access via https or http
      if (resUrlHttps) {
        image = testUrlHttps;
      } else if (resUrlHttp) {
        image = testUrlHttp;
      }
    }

    // check if url is accessible via image element
    async function checkUrlAccessibility(url: string): Promise<boolean> {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      });
    }

    return image;
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
