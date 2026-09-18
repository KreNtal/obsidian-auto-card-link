import { App, parseYaml, Notice, ButtonComponent, getLinkpath } from "obsidian";

import { YamlParseError, NoRequiredParamsError } from "./errors";
import { LinkMetadata } from "./interfaces";
import { CheckIf } from "./checkif";
import { CodeBlockGenerator } from "./code_block_generator";
import { ObsidianAutoCardLinkSettings } from "./settings";

export class CodeBlockProcessor {
  app: App;
  /**
   * Told about a URL the copy button just put on the clipboard. Copying from inside the app
   * never moves focus, so nothing else would prompt a re-read before the next right-click.
   */
  private onUrlCopied?: (url: string) => void;
  private settings?: ObsidianAutoCardLinkSettings;

  constructor(app: App, onUrlCopied?: (url: string) => void, settings?: ObsidianAutoCardLinkSettings) {
    this.app = app;
    this.onUrlCopied = onUrlCopied;
    this.settings = settings;
  }

  /**
   * Shows a card's title, marked if the link is dead (field rule J4) the way the setting says
   * now. The block's own title and status stay on the element, so a change of the setting can
   * re-mark every card already on screen without re-rendering it.
   */
  static showTitle(titleEl: HTMLElement, settings?: ObsidianAutoCardLinkSettings): void {
    const shown = CodeBlockGenerator.notFoundTitle(titleEl.dataset.title ?? "", titleEl.dataset.status, settings);
    const struck = shown.match(/^~~([\s\S]+)~~$/);
    titleEl.toggleClass("auto-card-link-title-not-found", !!struck);
    titleEl.setText(struck ? struck[1]! : shown);
  }

  async run(source: string, el: HTMLElement) {
    try {
      const data = this.parseLinkMetadataFromYaml(source);
      this.genLinkEl(data, el);
    } catch (error) {
      if (error instanceof NoRequiredParamsError) {
        this.genErrorEl(error.message, el);
      } else if (error instanceof YamlParseError) {
        this.genErrorEl(error.message, el);
      } else if (error instanceof TypeError) {
        this.genErrorEl("internal links must be surrounded by quotes.", el);
        console.error(error);
      } else {
        console.error("Code Block: cardlink unknown error", error);
      }
    }
  }

  /**
   * Best-effort parse of a whole ```cardlink block (fences included) back into its
   * metadata. Used by the refresh flow to know what the card showed before, so a
   * re-fetch that comes back short (e.g. Reddit's once-a-minute feed budget already
   * spent) can keep the old field instead of dropping it. Returns undefined rather
   * than throwing — a card we can't read just means nothing to preserve.
   */
  static tryParseBlock(block: string): LinkMetadata | undefined {
    const body = block
      .replace(/^[\s\S]*?```cardlink[^\n]*\n/, "")
      .replace(/\n```[\s\S]*$/, "");
    try {
      const yaml = parseYaml(body) as Partial<LinkMetadata> | null;
      if (!yaml || !yaml.url || !yaml.title) return undefined;
      return {
        url: yaml.url,
        title: yaml.title,
        author: yaml.author,
        description: yaml.description,
        host: yaml.host,
        favicon: yaml.favicon,
        image: yaml.image,
        duration: yaml.duration,
        status: yaml.status,
        indent: 0,
      };
    } catch {
      return undefined;
    }
  }

  private parseLinkMetadataFromYaml(source: string): LinkMetadata {
    let yaml: Partial<LinkMetadata>;

    let indent = -1;
    source = source
      .split(/\r?\n|\r|\n/g)
      .map((line) =>
        line.replace(/^\t+/g, (tabs) => {
          const n = tabs.length;
          if (indent < 0) {
            indent = n;
          }
          return " ".repeat(n);
        })
      )
      .join("\n");

    try {
      yaml = parseYaml(source) as Partial<LinkMetadata>;
    } catch (error) {
      console.error(error);
      throw new YamlParseError(
        "failed to parse yaml. Check debug console for more detail."
      );
    }

    if (!yaml || !yaml.url || !yaml.title) {
      throw new NoRequiredParamsError(
        "required params[url, title] are not found."
      );
    }

    return {
      url: yaml.url,
      title: yaml.title,
      author: yaml.author,
      description: yaml.description,
      host: yaml.host,
      favicon: yaml.favicon,
      image: yaml.image,
      duration: yaml.duration,
      status: yaml.status,
      indent,
    };
  }

  private genErrorEl(errorMsg: string, parentEl: HTMLElement): void {
    const containerEl = parentEl.createDiv({ cls: "auto-card-link-error-container" });
    containerEl.createSpan({ text: `cardlink error: ${errorMsg}` });
  }

  private genLinkEl(data: LinkMetadata, parentEl: HTMLElement): void {
    const containerEl = parentEl.createDiv({ cls: "auto-card-link-container" });
    containerEl.setAttr("data-auto-card-link-depth", data.indent);

    const cardEl = containerEl.createEl("a", {
      cls: "auto-card-link-card",
      href: data.url,
      attr: { rel: "noopener" },
    });

    // Deliberately not using a native `target="_blank"` anchor: Chromium handles that
    // navigation at the native "new-window" level without ever calling the JS `window.open`
    // function, so plugins that hook external-link opening by patching `window.open` (e.g.
    // "Open Link With") never see the click and can't redirect it. Opening the link ourselves
    // through `window.open` keeps the card on the same interceptable path as a normal
    // Obsidian-rendered external link.
    cardEl.addEventListener("click", (evt: MouseEvent) => {
      evt.preventDefault();
      window.open(data.url, "_blank", "noopener,noreferrer");
    });

    // Note: mainEl must be created before the thumbnail — the card uses
    // flex-direction: row-reverse, so the later child renders on the left.
    const mainEl = cardEl.createDiv({ cls: "auto-card-link-main" });

    const titleEl = mainEl.createDiv({ cls: "auto-card-link-title" });
    titleEl.dataset.title = data.title;
    if (data.status) titleEl.dataset.status = data.status;
    CodeBlockProcessor.showTitle(titleEl, this.settings);

    if (data.description) {
      mainEl.createDiv({ cls: "auto-card-link-description", text: data.description });
    }

    const hostEl = mainEl.createDiv({ cls: "auto-card-link-host" });

    if (data.favicon) {
      if (!CheckIf.isUrl(data.favicon))
        data.favicon = this.getLocalImagePath(data.favicon);

      const faviconEl = hostEl.createEl("img", {
        cls: "auto-card-link-favicon",
        attr: { src: data.favicon },
      });

      // Fallback to Google favicon service if direct URL fails to load
      if (data.host) {
        const fallbackUrl = `https://www.google.com/s2/favicons?domain=${data.host}&sz=32`;
        faviconEl.onerror = () => {
          if (faviconEl.src !== fallbackUrl) {
            faviconEl.src = fallbackUrl;
          }
        };
      }
    }

    if (data.host) {
      hostEl.createSpan({ text: data.host });
    }

    if (data.author) {
      hostEl.createSpan({ cls: "auto-card-link-author", text: `· ${data.author}` });
    }

    if (data.image) {
      if (!CheckIf.isUrl(data.image))
        data.image = this.getLocalImagePath(data.image);

      const thumbnailWrapEl = cardEl.createDiv({ cls: "auto-card-link-thumbnail-wrap" });

      const thumbnailEl = thumbnailWrapEl.createEl("img", {
        cls: "auto-card-link-thumbnail",
        attr: { src: data.image, draggable: "false" },
      });

      // If the image URL is dead (expired signed URL, 404, hotlink block, …),
      // drop the whole thumbnail so the card collapses to a clean text-only layout
      // instead of showing the browser's broken-image glyph.
      thumbnailEl.onerror = () => {
        thumbnailWrapEl.remove();
      };

      if (data.duration) {
        thumbnailWrapEl.createSpan({ cls: "auto-card-link-duration", text: data.duration });
      }
    }

    new ButtonComponent(containerEl)
      .setClass("auto-card-link-copy-url")
      .setClass("clickable-icon")
      .setIcon("copy")
      .setTooltip(`Copy URL\n${data.url}`)
      .onClick(() => {
        void navigator.clipboard.writeText(data.url);
        this.onUrlCopied?.(data.url);
        new Notice("URL copied to your clipboard");
      });
  }

  private getLocalImagePath(link: string): string {
    link = link.slice(2, -2); // remove [[]]
    const imageRelativePath = this.app.metadataCache.getFirstLinkpathDest(
      getLinkpath(link),
      ""
    )?.path;

    if (!imageRelativePath) return link;

    return this.app.vault.adapter.getResourcePath(imageRelativePath);
  }
}
