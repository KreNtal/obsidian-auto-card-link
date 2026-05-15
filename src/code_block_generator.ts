import { App, Editor, Notice } from "obsidian";

import { LinkMetadata } from "./interfaces";
import { EditorExtensions } from "./editor_enhancements";
import { LinkMetadataFetcher } from "./link_metadata_fetcher";
import { ObsidianAutoCardLinkSettings } from "./settings";
import { downloadImage } from "./image_downloader";
import { CheckIf } from "./checkif";

export class CodeBlockGenerator {
  editor: Editor;
  private app?: App;
  private settings?: ObsidianAutoCardLinkSettings;
  private fetcher = new LinkMetadataFetcher();

  constructor(editor: Editor, app?: App, settings?: ObsidianAutoCardLinkSettings) {
    this.editor = editor;
    this.app = app;
    this.settings = settings;
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

      const prefix = this.buildPrefix(text, startPos);
      this.editor.replaceRange(prefix + this.genCodeBlock(linkMetadata), startPos, endPos);
    } catch (e) {
      console.error("convertUrlToCodeBlock failed:", e);
      new Notice("Couldn't fetch link metadata");

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

  private buildPrefix(text: string, startPos: { line: number; ch: number; }): string {
    const blankLine = this.settings?.blankLineBeforeCard ?? false;

    if (startPos.ch > 0) {
      // Cursor is mid-line: always break to a new line, optionally add blank line
      return blankLine ? "\n\n" : "\n";
    }

    if (blankLine && startPos.line > 0) {
      // At the start of a line: check if the line above is already blank
      const prevLine = (text.split(/\r?\n/)[startPos.line - 1] ?? "").trim();
      return prevLine !== "" ? "\n" : "";
    }

    return "";
  }

  genCodeBlock(linkMetadata: LinkMetadata): string {
    const codeBlockTexts = ["```cardlink"];

    codeBlockTexts.push(`url: ${linkMetadata.url}`);
    codeBlockTexts.push(`title: "${linkMetadata.title}"`);
    if (linkMetadata.author) codeBlockTexts.push(`author: "${linkMetadata.author}"`);
    if (linkMetadata.description) codeBlockTexts.push(`description: "${linkMetadata.description}"`);
    if (linkMetadata.host) codeBlockTexts.push(`host: ${linkMetadata.host}`);
    if (linkMetadata.favicon) codeBlockTexts.push(`favicon: ${linkMetadata.favicon}`);
    if (linkMetadata.image) codeBlockTexts.push(`image: ${linkMetadata.image}`);
    if (linkMetadata.duration) codeBlockTexts.push(`duration: "${linkMetadata.duration}"`);

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

  private async fetchLinkMetadata(url: string): Promise<LinkMetadata | undefined> {
    const metadata = await this.fetcher.fetch(url);
    if (!metadata || !this.app || !this.settings) return metadata;

    if (this.settings.downloadImages && metadata.image && CheckIf.isUrl(metadata.image)) {
      const localPath = await downloadImage(this.app, metadata.image, this.settings.imageFolder || "AutoCardLink");
      if (localPath) metadata.image = `"[[${localPath}]]"`;
    }

    if (this.settings.downloadFavicons && metadata.favicon && CheckIf.isUrl(metadata.favicon)) {
      const localPath = await downloadImage(this.app, metadata.favicon, this.settings.faviconFolder || "AutoCardLink/favicons");
      if (localPath) metadata.favicon = `"[[${localPath}]]"`;
    }

    return metadata;
  }
}
