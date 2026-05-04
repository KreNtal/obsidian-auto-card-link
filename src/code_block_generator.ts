import { Editor, Notice, requestUrl } from "obsidian";

import { LinkMetadata } from "src/interfaces";
import { EditorExtensions } from "src/editor_enhancements";
import { LinkMetadataParser } from "src/link_metadata_parser";

export class CodeBlockGenerator {
  editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  async convertUrlToCodeBlock(url: string): Promise<void> {
    const selectedText = this.editor.getSelection();

    // Generate a unique id for find/replace operations.
    const pasteId = this.createBlockHash();
    const fetchingText = `[Fetching Data#${pasteId}](${url})`;

    // Instantly paste so you don't wonder if paste is broken
    this.editor.replaceSelection(fetchingText);

    const linkMetadata = await this.fetchLinkMetadata(url);

    const text = this.editor.getValue();
    const start = text.indexOf(fetchingText);

    if (start < 0) {
      console.log(
        `Unable to find text "${fetchingText}" in current editor, bailing out; link ${url}`
      );
      return;
    }

    const end = start + fetchingText.length;
    const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
    const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);

    // if failed to link metadata, show notification and revert
    if (!linkMetadata) {
      new Notice("Couldn't fetch link metadata");
      this.editor.replaceRange(selectedText || url, startPos, endPos);
      return;
    }
    this.editor.replaceRange(this.genCodeBlock(linkMetadata), startPos, endPos);
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

  private async fetchLinkMetadata(
    url: string
  ): Promise<LinkMetadata | undefined> {
    if (this.isYouTubeUrl(url)) {
      return this.fetchYouTubeLinkMetadata(url);
    }
    const res = await (async () => {
      try {
        return requestUrl({ url });
      } catch (e) {
        console.log(e);
        return;
      }
    })();
    if (!res || res.status != 200) {
      console.log(`bad response. response status code was ${res?.status}`);
      return;
    }

    const parser = new LinkMetadataParser(url, res.text);
    return parser.parse();
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

  private isYouTubeUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/)/.test(url);
  }

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
      title: data.title,
      description: `By ${data.author_name}`,
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
}
