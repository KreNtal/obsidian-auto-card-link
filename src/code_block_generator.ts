import { Editor, Notice, requestUrl } from "obsidian";

import { LinkMetadata } from "src/interfaces";
import { EditorExtensions } from "src/editor_enhancements";
import { LinkMetadataParser } from "src/link_metadata_parser";
import { CheckIf } from "./checkif";

export class CodeBlockGenerator {
  editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  async convertUrlToCodeBlock(url: string): Promise<void> {
    const selectedText = this.editor.getSelection();
    const pasteId = this.createBlockHash();
    const fetchingText = `[Fetching Data#${pasteId}](${url})`;

    this.editor.replaceSelection(fetchingText);

    try {
      const linkMetadata = await this.fetchLinkMetadata(url);

      const text = this.editor.getValue();
      const start = text.indexOf(fetchingText);

      if (start < 0) {
        console.log(`Unable to find text "${fetchingText}" in current editor, bailing out; link ${url}`);
        return;
      }

      const end = start + fetchingText.length;
      const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
      const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);

      if (!linkMetadata) {
        new Notice("Couldn't fetch link metadata");
        this.editor.replaceRange(selectedText || `[${url}](${url})`, startPos, endPos);
        return;
      }

      this.editor.replaceRange(this.genCodeBlock(linkMetadata), startPos, endPos);
    } catch (e) {
      console.error("convertUrlToCodeBlock failed:", e);
      new Notice("Couldn't fetch link metadata");

      // find and revert the placeholder
      const text = this.editor.getValue();
      const start = text.indexOf(fetchingText);
      if (start >= 0) {
        const end = start + fetchingText.length;
        const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
        const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);
        this.editor.replaceRange(selectedText || `[${url}](${url})`, startPos, endPos);
      }
    }
  }

  genCodeBlock(linkMetadata: LinkMetadata): string {
    const codeBlockTexts = ["\n```cardlink"];
    codeBlockTexts.push(`url: ${linkMetadata.url}`);
    codeBlockTexts.push(`title: "${linkMetadata.title}"`);
    if (linkMetadata.description)
      codeBlockTexts.push(`description: "${linkMetadata.description}"`);
    if (linkMetadata.host) codeBlockTexts.push(`host: ${linkMetadata.host}`);
    if (linkMetadata.favicon)
      codeBlockTexts.push(`favicon: ${linkMetadata.favicon}`);
    if (linkMetadata.image) codeBlockTexts.push(`image: ${linkMetadata.image}`);
    codeBlockTexts.push("```\n");
    return codeBlockTexts.join("\n");
  }

  private createBlockHash(): string {
    let result = "";
    const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    for (let i = 0; i < 4; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  private async fetchLinkMetadata(
    url: string
  ): Promise<LinkMetadata | undefined> {
    if (CheckIf.isYouTubeUrl(url))
      return this.fetchYouTubeLinkMetadata(url);

    if (CheckIf.isRedditUrl(url))
      return this.fetchRedditLinkMetadata(url);

    const res = await (async () => {
      try {
        return requestUrl({
          url,
          headers: {                                          // ← ADD
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },                                                  // ← END ADD
        });
      } catch (e) {
        console.log(e);
        return;
      }
    })();

    if (!res || res.status != 200) {
      console.log(`bad response. response status code was ${res?.status}`);
      return {
        url,
        title: "Fetch error",
        description: res ? `HTTP ${res.status}` : "Request failed",
        host: new URL(url).hostname,
        indent: 0,
      };
    }

    const parser = new LinkMetadataParser(url, res.text);
    return parser.parse();
  }

  /* --- YOUTUBE --- */
  private async fetchYouTubeLinkMetadata(
    url: string
  ): Promise<LinkMetadata | undefined> {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await (async () => {
      try {
        return requestUrl({ url: oembedUrl });
      } catch (e) {
        console.log(e);
        return;
      }
    })();
    if (!res || res.status !== 200) return;

    const data = JSON.parse(res.text);
    const videoId = this.getYouTubeVideoId(url);  // ← extract ID
    const image = videoId
      ? await this.getBestYouTubeThumbnail(videoId)  // ← try HD first
      : data.thumbnail_url;                           // ← fallback to oEmbed

    return {
      url,
      title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
      description: LinkMetadataParser.sanitizeText(`By ${data.author_name}`) ?? `By ${data.author_name}`,
      host: "www.youtube.com",
      favicon: "https://www.youtube.com/favicon.ico",
      image,
      indent: 0,
    };
  }

  private getYouTubeVideoId(url: string): string | undefined {
    const match = url.match(
      /(?:youtube\.com\/watch\?.*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match?.[1];
  }

  private async getBestYouTubeThumbnail(videoId: string): Promise<string> {
    // YouTube thumbnail qualities in descending order
    const qualities = ["maxresdefault", "sddefault", "hqdefault"];
    for (const q of qualities) {
      const thumbUrl = `https://i.ytimg.com/vi/${videoId}/${q}.jpg`;
      const res = await (async () => {
        try { return requestUrl({ url: thumbUrl }); }
        catch { return; }
      })();
      if (res && res.status === 200) return thumbUrl;
    }
    // last resort fallback
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  /* --- REDDIT --- */
  private async fetchRedditLinkMetadata(
    url: string
  ): Promise<LinkMetadata | undefined> {
    // Normalize: strip old.reddit.com → www.reddit.com, ensure trailing slash
    const normalized = url
      .replace("old.reddit.com", "www.reddit.com")
      .replace(/\/?$/, "/");

    const isPost = /reddit\.com\/r\/\w+\/comments\//.test(normalized);
    const isSubreddit = /reddit\.com\/r\/\w+\/?$/.test(normalized);
    const isUser = /reddit\.com\/(?:u|user)\/\w+/.test(normalized);

    if (isPost) {
      return this.fetchRedditPost(url, normalized);
    } else if (isSubreddit) {
      return this.fetchRedditSubreddit(url, normalized);
    } else if (isUser) {
      return this.fetchRedditUser(url, normalized);
    }

    return undefined;
  }

  private async fetchRedditPost(
    originalUrl: string,
    normalized: string
  ): Promise<LinkMetadata | undefined> {
    const jsonUrl = normalized.replace(/\/?$/, ".json") + "?limit=1";
    const res = await (async () => {
      try {
        return requestUrl({
          url: jsonUrl,
          headers: { "User-Agent": "obsidian-auto-card-link/1.0" },
        });
      } catch (e) {
        console.log(e);
        return;
      }
    })();
    if (!res || res.status !== 200) return;

    const data = JSON.parse(res.text);
    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) return;

    // preview.images URLs are HTML-encoded — decode the ampersands
    const rawImage =
      post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&");
    const image = rawImage && !["self", "default", "nsfw", ""].includes(rawImage)
      ? rawImage
      : undefined;

    return {
      url: originalUrl,
      title: LinkMetadataParser.sanitizeText(post.title) ?? post.title,
      description: LinkMetadataParser.sanitizeText(
        post.selftext
          ? post.selftext.slice(0, 200).replace(/\n/g, " ") + "…"
          : `Posted by u/${post.author} in r/${post.subreddit}`),
      host: "www.reddit.com",
      favicon: "https://www.reddit.com/favicon.ico",
      image,
      indent: 0,
    };
  }

  private async fetchRedditSubreddit(
    originalUrl: string,
    normalized: string
  ): Promise<LinkMetadata | undefined> {
    // Use /about.json to get subreddit metadata (description, icon, etc.)
    const aboutUrl = normalized.replace(/\/?$/, "/about.json");
    const res = await (async () => {
      try {
        return requestUrl({
          url: aboutUrl,
          headers: { "User-Agent": "obsidian-auto-card-link/1.0" },
        });
      } catch (e) {
        console.log(e);
        return;
      }
    })();
    if (!res || res.status !== 200) return;

    const sub = JSON.parse(res.text)?.data;
    if (!sub) return;

    // community_icon has URL-encoded chars; icon_img is fallback
    const rawIcon = sub.community_icon || sub.icon_img || "";
    const image = rawIcon.split("?")[0] || undefined; // strip query params

    return {
      url: originalUrl,
      title: `r/${sub.display_name}`,
      description: sub.public_description?.trim() || undefined,
      host: "www.reddit.com",
      favicon: "https://www.reddit.com/favicon.ico",
      image: image || undefined,
      indent: 0,
    };
  }

  private async fetchRedditUser(
    originalUrl: string,
    normalized: string
  ): Promise<LinkMetadata | undefined> {
    // Extract username and call /user/{name}/about.json
    const match = normalized.match(/reddit\.com\/(?:u|user)\/(\w+)/);
    if (!match) return;
    const username = match[1];

    const aboutUrl = `https://www.reddit.com/user/${username}/about.json`;
    const res = await (async () => {
      try {
        return requestUrl({
          url: aboutUrl,
          headers: { "User-Agent": "obsidian-auto-card-link/1.0" },
        });
      } catch (e) {
        console.log(e);
        return;
      }
    })();
    if (!res || res.status !== 200) return;

    const user = JSON.parse(res.text)?.data;
    if (!user) return;

    return {
      url: originalUrl,
      title: `u/${user.name}`,
      description: user.subreddit?.public_description?.trim() || undefined,
      host: "www.reddit.com",
      favicon: "https://www.reddit.com/favicon.ico",
      image: user.icon_img?.split("?")[0] || undefined,
      indent: 0,
    };
  }
}
