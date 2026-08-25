import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder, setIcon } from "obsidian";
import ObsidianAutoCardLink from "./main";

class FolderSuggest extends AbstractInputSuggest<string> {
  private folders: string[];
  private input: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.input = inputEl;
    this.folders = ["/"].concat(
      this.app.vault.getAllLoadedFiles()
        .filter((f): f is TFolder => f instanceof TFolder)
        .map(f => f.path)
    );
  }

  getSuggestions(query: string): string[] {
    const lower = query.toLowerCase();
    return this.folders.filter(f => f.toLowerCase().includes(lower));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.createDiv({ text: folder });
  }

  selectSuggestion(folder: string): void {
    this.input.value = folder;
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}

export interface ObsidianAutoCardLinkSettings {
  enhanceDefaultPaste: boolean;
  pasteAs: "card" | "markdown-link";
  enhanceDefaultDrop: boolean;
  dropAs: "card" | "markdown-link";
  showInMenuItem: boolean;
  blankLineBeforeCard: boolean;
  thumbnailPosition: "left" | "right";
  downloadImages: boolean;
  imageFolder: string;
  downloadFavicons: boolean;
  faviconFolder: string;
  cardStyle: "classic" | "modern" | "glass" | "compact";
  thumbnailQuality: "better-preview" | "max-resolution";
  useExternalFallback: boolean;
  thumbnailFit: "cover" | "contain";
}

export const DEFAULT_SETTINGS: ObsidianAutoCardLinkSettings = {
  enhanceDefaultPaste: false,
  pasteAs: "card",
  enhanceDefaultDrop: false,
  dropAs: "card",
  showInMenuItem: true,
  blankLineBeforeCard: false,
  thumbnailPosition: "left",
  downloadImages: false,
  imageFolder: "AutoCardLink/images",
  downloadFavicons: false,
  faviconFolder: "AutoCardLink/favicons",
  cardStyle: "classic",
  thumbnailQuality: "better-preview",
  useExternalFallback: false,
  thumbnailFit: "cover",
};

export class ObsidianAutoCardLinkSettingTab extends PluginSettingTab {
  plugin: ObsidianAutoCardLink;

  constructor(app: App, plugin: ObsidianAutoCardLink) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Plugins that also turn a pasted or dropped URL into an inline markdown link, and so
   * compete for the same event when our own output shape is set to one.
   *
   * Detection has to go by known id: nothing in the API reports which plugins listen to
   * an editor event, so a generic "someone else handles this" check isn't possible.
   */
  private static readonly COMPETING_PLUGIN_IDS = [
    "obsidian-auto-link-title",
    "url-into-selection",
    "obsidian-link-embed",
  ];

  /**
   * `plugins` is real on the App instance but absent from the public typings, so read it
   * through a narrow local shape rather than `any` (which ESLint rejects). The display
   * name comes from the manifest so it always matches what the plugin list shows.
   */
  private enabledCompetingPluginNames(): string[] {
    const app = this.app as App & {
      plugins?: {
        enabledPlugins?: Set<string>;
        manifests?: Record<string, { name?: string; }>;
      };
    };

    return ObsidianAutoCardLinkSettingTab.COMPETING_PLUGIN_IDS
      .filter(id => app.plugins?.enabledPlugins?.has(id))
      .map(id => app.plugins?.manifests?.[id]?.name ?? id);
  }

  /** "Paste as" and "Drop as" differ only in their text and where they store the value. */
  private addOutputShapeSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    current: "card" | "markdown-link",
    assign: (value: "card" | "markdown-link") => void
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addDropdown((drop) => drop
        .addOption("card", "Card link")
        .addOption("markdown-link", "Markdown link")
        .setValue(current)
        .onChange(async (value: string) => {
          assign(value as "card" | "markdown-link");
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  /**
   * One notice covering every competing plugin that is enabled, shown only while we
   * actually intercept something. The clash is over the event itself, not over what we
   * insert: whichever plugin's handler runs first wins the paste, so a card is no safer
   * than an inline link here.
   */
  private addCollisionWarning(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    if (!settings?.enhanceDefaultPaste && !settings?.enhanceDefaultDrop) return;

    const names = this.enabledCompetingPluginNames();
    if (names.length === 0) return;

    const list = names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : names[0];

    new Setting(containerEl)
      .setName(this.warningLabel(names.length > 1
        ? "Other plugins also handle these events!"
        : "Another plugin also handles these events!"))
      .setDesc(`${list} also act${names.length > 1 ? "" : "s"} on URLs you paste or drop, so whichever plugin handles the event first wins it. Either disable the other one, or turn the two options below off and use the hotkey-assignable commands instead.`)
      .setClass("auto-card-link-warning");
  }

  /** A setting name prefixed with a warning icon. */
  private warningLabel(text: string): DocumentFragment {
    const label = activeDocument.createDocumentFragment();
    setIcon(label.createSpan({ cls: "auto-card-link-warning-icon" }), "alert-triangle");
    label.appendText(text);
    return label;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addCollisionWarning(containerEl);

    new Setting(containerEl)
      .setName("Enhance default paste")
      .setDesc("Fetch the link metadata when pasting a URL in the editor with the default paste command.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.enhanceDefaultPaste)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.enhanceDefaultPaste = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // Shown only while the paste above is enhanced: on its own this option does nothing,
    // and leaving it visible reads as a setting that has quietly stopped working.
    if (this.plugin.settings?.enhanceDefaultPaste) {
      this.addOutputShapeSetting(
        containerEl,
        "Paste as",
        "What an enhanced paste inserts. Card link builds the full card block; Markdown link inserts an inline link labelled with the fetched page title and the site name. This only affects the default paste — the paste-and-enhance commands stay available for both shapes, so you can bind each to its own hotkey.",
        this.plugin.settings.pasteAs,
        (value) => { if (this.plugin.settings) this.plugin.settings.pasteAs = value; }
      );
    }

    new Setting(containerEl)
      .setName("Enhance default drop")
      .setDesc("Fetch the link metadata when dropping a URL into the editor, for instance dragged from a browser's address bar.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.enhanceDefaultDrop)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.enhanceDefaultDrop = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings?.enhanceDefaultDrop) {
      this.addOutputShapeSetting(
        containerEl,
        "Drop as",
        "What an enhanced drop inserts. Kept separate from the paste option so a dropped URL can always become a card even when pasting produces a Markdown link.",
        this.plugin.settings.dropAs,
        (value) => { if (this.plugin.settings) this.plugin.settings.dropAs = value; }
      );
    }

    containerEl.createEl("hr", { cls: "auto-card-link-settings-divider" });

    new Setting(containerEl)
      .setName("Add commands in menu item")
      .setDesc("Whether to add commands in right click menu items (refresh and delete will always be visible).")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.showInMenuItem)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.showInMenuItem = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Add blank line before card")
      .setDesc("Insert an empty line before each card link block when converting a URL.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.blankLineBeforeCard)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.blankLineBeforeCard = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Use external service for blocked sites")
      .setDesc("When a site blocks direct fetching, fetch its metadata through the external microlink.io service as a last resort. This sends the link's URL to microlink.io. Off by default for privacy; only used when the normal fetch fails.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.useExternalFallback)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.useExternalFallback = value;
            await this.plugin.saveSettings();
          });
      });

    // --- Images ---
    new Setting(containerEl).setName("Images").setHeading();

    new Setting(containerEl)
      .setName("Thumbnail quality")
      .setDesc("Best looking fetches a size matched to the card dimensions, sharper and faster to load. Max resolution always fetches the highest available resolution, but it takes up more disk space and can look pixelated.")
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("better-preview", "Best looking")
          .addOption("max-resolution", "Max resolution")
          .setValue(this.plugin.settings.thumbnailQuality)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.thumbnailQuality = value as "better-preview" | "max-resolution";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Save images locally")
      .setDesc("Download and save card thumbnail images to your vault instead of linking to remote URLs.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.downloadImages)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.downloadImages = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Image folder")
      .setDesc("Vault folder where downloaded images are saved.")
      .addSearch((search) => {
        if (!this.plugin.settings) return;
        search
          .setPlaceholder("AutoCardLink/images")
          .setValue(this.plugin.settings.imageFolder)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.imageFolder = value.trim() || "AutoCardLink/images";
            await this.plugin.saveSettings();
          });
        new FolderSuggest(this.app, search.inputEl);
      });

    new Setting(containerEl)
      .setName("Save favicons locally")
      .setDesc("Download and save card favicons to your vault instead of linking to remote URLs.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.downloadFavicons)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.downloadFavicons = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Favicon folder")
      .setDesc("Vault folder where downloaded favicons are saved.")
      .addSearch((search) => {
        if (!this.plugin.settings) return;
        search
          .setPlaceholder("AutoCardLink/favicons")
          .setValue(this.plugin.settings.faviconFolder)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.faviconFolder = value.trim() || "AutoCardLink/favicons";
            await this.plugin.saveSettings();
          });
        new FolderSuggest(this.app, search.inputEl);
      });

    // --- Appearance ---
    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Card style")
      .setDesc("Visual style of the card link.")
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("classic", "Classic")
          .addOption("modern", "Modern")
          .addOption("glass", "Glass")
          .addOption("compact", "Compact")
          .setValue(this.plugin.settings.cardStyle)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.cardStyle = value as "classic" | "modern" | "glass" | "compact";
            await this.plugin.saveSettings();
            applyCardStyle(this.plugin.settings.cardStyle);
          });
      });

    new Setting(containerEl)
      .setName("Thumbnail position")
      .setDesc("Which side of the card the thumbnail appears on.")
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("left", "Left")
          .addOption("right", "Right")
          .setValue(this.plugin.settings.thumbnailPosition)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.thumbnailPosition = value as "left" | "right";
            await this.plugin.saveSettings();
            applyThumbnailPosition(value as "left" | "right");
          });
      });

    new Setting(containerEl)
      .setName("Thumbnail fit")
      .setDesc("How the thumbnail image fills its frame: crop to fill, or shrink to show the whole image.")
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("cover", "Crop to fill")
          .addOption("contain", "Show whole image")
          .setValue(this.plugin.settings.thumbnailFit)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.thumbnailFit = value as "cover" | "contain";
            await this.plugin.saveSettings();
            applyThumbnailFit(this.plugin.settings.thumbnailFit);
          });
      });
  }
}

export function applyThumbnailPosition(position: "left" | "right"): void {
  activeDocument.body.classList.toggle(
    "auto-card-link-thumbnail-right",
    position === "right"
  );
}

export function applyCardStyle(style: "classic" | "modern" | "glass" | "compact"): void {
  activeDocument.body.classList.remove(
    "auto-card-link-style-modern",
    "auto-card-link-style-glass",
    "auto-card-link-style-compact"
  );
  if (style !== "classic") activeDocument.body.classList.add(`auto-card-link-style-${style}`);
}

export function applyThumbnailFit(fit: "cover" | "contain"): void {
  activeDocument.body.classList.toggle(
    "auto-card-link-thumbnail-fit-contain",
    fit === "contain"
  );
}