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
  private fetcher: LinkMetadataFetcher;

  /** What we put between title and site name, whatever separator the site itself uses. */
  private static readonly SEPARATOR = "-";
  /** Separators sites are seen to use, for detecting a site name already in the title. */
  private static readonly SEPARATORS = "-|·:–—";

  constructor(editor: Editor, app?: App, settings?: ObsidianAutoCardLinkSettings) {
    this.editor = editor;
    this.app = app;
    this.settings = settings;
    this.fetcher = new LinkMetadataFetcher(settings);
  }

  async convertUrlToCodeBlock(
    url: string,
    fallbackText?: string,
    options?: { trailingNewline?: boolean; }
  ): Promise<boolean> {
    const located = await this.fetchThroughPlaceholder(url, fallbackText);
    if (!located) return false;

    const { metadata, text, startPos, endPos } = located;
    const prefix = this.buildPrefix(text, startPos);
    const block = this.genCodeBlock(metadata, options?.trailingNewline ?? true);
    this.editor.replaceRange(prefix + block, startPos, endPos);
    return true;
  }

  /**
   * Inserts `[title](url)` instead of a card block. Shares the whole placeholder /
   * retry / restore dance with convertUrlToCodeBlock, but stays inline: no prefix,
   * no blank line, no code fence.
   */
  async convertUrlToMarkdownLink(url: string, fallbackText?: string): Promise<boolean> {
    const located = await this.fetchThroughPlaceholder(url, fallbackText, { titleOnly: true });
    if (!located) return false;

    const { metadata, startPos, endPos } = located;
    this.editor.replaceRange(
      CodeBlockGenerator.buildMarkdownLink(metadata.linkTitle ?? metadata.title, url, metadata.siteName),
      startPos,
      endPos
    );
    return true;
  }

  /**
   * Inserts a `[Fetching Data#hash](url)` placeholder, fetches the metadata (with one
   * retry), then locates the placeholder again — the note may have been edited while
   * the request was in flight. Returns undefined when the placeholder is gone or the
   * fetch produced nothing usable; in the latter case the original text is restored.
   */
  private async fetchThroughPlaceholder(
    url: string,
    fallbackText?: string,
    options?: { titleOnly?: boolean; }
  ): Promise<{ metadata: LinkMetadata; text: string; startPos: { line: number; ch: number; }; endPos: { line: number; ch: number; }; } | undefined> {
    const selectedText = fallbackText ?? this.editor.getSelection();
    const pasteId = this.createBlockHash();
    const fetchingText = `[Fetching Data#${pasteId}](${url})`;

    this.editor.replaceSelection(fetchingText);

    const locate = () => {
      const text = this.editor.getValue();
      const start = text.indexOf(fetchingText);
      if (start < 0) return undefined;
      const end = start + fetchingText.length;
      return {
        text,
        startPos: EditorExtensions.getEditorPositionFromIndex(text, start),
        endPos: EditorExtensions.getEditorPositionFromIndex(text, end),
      };
    };

    const restoreFallback = () => {
      const found = locate();
      if (!found) return;
      const replacement = options?.titleOnly
        ? (selectedText || url)
        : (selectedText || `[${url}](${url})`);
      this.editor.replaceRange(replacement, found.startPos, found.endPos);
    };

    const tryFetch = () => this.fetchLinkMetadata(url, options);

    let linkMetadata = await tryFetch().catch(() => null);

    // One retry on transient failure
    if (linkMetadata === null) {
      await new Promise(r => window.setTimeout(r, 1500));
      linkMetadata = await tryFetch().catch(() => undefined);
    }

    const found = locate();
    if (!found) {
      console.debug(`Unable to find text "${fetchingText}" in current editor, bailing out; link ${url}`);
      return undefined;
    }

    // For a markdown link, a title that is just the hostname is what fetchTitleOnly
    // returns when it found nothing — no better than the bare URL, so treat it as a
    // failure rather than writing [example.com](https://example.com/page).
    const unusableTitle = options?.titleOnly && linkMetadata
      && (!linkMetadata.title.trim() || linkMetadata.title.trim() === new URL(url).hostname);

    if (!linkMetadata || unusableTitle) {
      if (!options?.titleOnly) new Notice("Couldn't fetch link metadata");
      restoreFallback();
      return undefined;
    }

    return { metadata: linkMetadata, ...found };
  }

  /**
   * Escapes a title for use as markdown link text: brackets would otherwise close
   * the link early, and newlines/tabs would break it across lines.
   */
  /**
   * Builds `[text](url)`, escaping both halves so neither can break the link, and
   * appending the site name when one is known.
   */
  static buildMarkdownLink(text: string, url: string, siteName?: string): string {
    const label = CodeBlockGenerator.appendSiteName(text, siteName);
    return `[${CodeBlockGenerator.escapeMarkdownLinkText(label)}](${CodeBlockGenerator.markdownLinkTarget(url)})`;
  }

  /**
   * Turns "Prinz Eugen" into "Prinz Eugen — Wikipedia"-style labels. An inline link
   * has no room for the host the card shows separately, so the site name goes in the
   * text — which is also what a site's own <title> normally does.
   */
  private static appendSiteName(title: string, siteName?: string): string {
    const trimmed = title.trim();
    if (!siteName) return trimmed;
    if (!trimmed) return siteName;

    const lower = trimmed.toLowerCase();
    const name = siteName.toLowerCase();
    if (lower === name) return trimmed;

    // Many titles already carry the site name, each site with its own separator. When the
    // title is segmented, the site named itself in the last segment - either bare
    // ("owner/repo · GitHub") or inside a phrase ("Episode - Show | Podcast on Spotify").
    // Requiring a separator is what keeps a title that merely ends with the word
    // ("How to use Spotify") from losing its suffix.
    const segments = trimmed.split(/\s*[-|\u2013\u2014\u00b7:]\s*/);
    if (segments.length > 1 && (segments[segments.length - 1] ?? "").toLowerCase().endsWith(name)) {
      return trimmed;
    }

    // The site name can just as well open the title ("Obsidian - Sharpen your thinking"),
    // in which case appending it again reads as a stutter.
    if (lower.startsWith(name)) {
      const tail = trimmed.slice(siteName.length).trimStart();
      if (CodeBlockGenerator.SEPARATORS.includes(tail.charAt(0))) return trimmed;
    }

    return `${trimmed} ${CodeBlockGenerator.SEPARATOR} ${siteName}`;
  }

  private static escapeMarkdownLinkText(title: string): string {
    return title
      // Titles arrive escaped for the card block's YAML (LinkMetadataParser.sanitizeText
      // turns a quote into an escaped quote, and a backslash into two). That escaping is
      // wrong in a markdown link, where the text is literal, so undo it first.
      .replace(/\\(["\\])/g, "$1")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/ {2,}/g, " ")
      .replace(/([[\]])/g, "\\$1")
      .trim();
  }

  /**
   * A URL containing spaces or parentheses breaks the `(...)` target; markdown
   * allows wrapping it in angle brackets instead.
   */
  private static markdownLinkTarget(url: string): string {
    return /[\s()]/.test(url) ? `<${url}>` : url;
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

  /**
   * `trailingNewline` closes the block with a line break, leaving a blank line after it when
   * the block replaced something that already ended a line. Converting several URLs in one
   * go turns that off for all but the last, so the cards end up stacked rather than spaced.
   */
  genCodeBlock(linkMetadata: LinkMetadata, trailingNewline = true): string {
    const codeBlockTexts = ["```cardlink"];

    codeBlockTexts.push(`url: ${linkMetadata.url}`);
    codeBlockTexts.push(`title: ${this.yamlQuote(linkMetadata.title)}`);
    if (linkMetadata.author) codeBlockTexts.push(`author: ${this.yamlQuote(linkMetadata.author)}`);
    if (linkMetadata.description) codeBlockTexts.push(`description: ${this.yamlQuote(linkMetadata.description)}`);
    if (linkMetadata.host) codeBlockTexts.push(`host: ${linkMetadata.host}`);
    // image/favicon are either a plain URL or a pre-quoted "[[wikilink]]" string
    // (see fetchLinkMetadata below) — never re-quote them here.
    if (linkMetadata.favicon) codeBlockTexts.push(`favicon: ${linkMetadata.favicon}`);
    if (linkMetadata.image) codeBlockTexts.push(`image: ${linkMetadata.image}`);
    if (linkMetadata.duration) codeBlockTexts.push(`duration: ${this.yamlQuote(linkMetadata.duration)}`);

    codeBlockTexts.push(trailingNewline ? "```\n" : "```");
    return codeBlockTexts.join("\n");
  }

  /**
   * Renders a plain string as a safe double-quoted YAML scalar: collapses any
   * embedded newlines/tabs to single spaces (a bare multiline value would
   * otherwise break the block's YAML) and escapes quotes/backslashes via
   * JSON string syntax, which is valid YAML double-quoted scalar syntax.
   */
  private yamlQuote(value: string): string {
    const normalized = value
      .replace(/\r\n|\r|\n/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    return JSON.stringify(normalized);
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
    url: string,
    options?: { titleOnly?: boolean; }
  ): Promise<LinkMetadata | undefined> {
    const metadata = await this.fetcher.fetch(url);
    // A markdown link only shows the title, so skip downloading images/favicons.
    if (!metadata || options?.titleOnly || !this.app || !this.settings) return metadata;

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
