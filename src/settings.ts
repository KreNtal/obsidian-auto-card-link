import { AbstractInputSuggest, App, PluginSettingTab, Setting } from "obsidian";
import ObsidianAutoCardLink from "./main";

class FolderSuggest extends AbstractInputSuggest<string> {
  private folders: string[];
  private input: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.input = inputEl;
    this.folders = ["/"].concat(this.app.vault.getAllFolders().map(f => f.path));
  }

  getSuggestions(query: string): string[] {
    const lower = query.toLowerCase();
    return this.folders.filter(f => f.toLowerCase().includes(lower));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.createEl("div", { text: folder });
  }

  selectSuggestion(folder: string): void {
    this.input.value = folder;
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}

export interface ObsidianAutoCardLinkSettings {
  showInMenuItem: boolean;
  enhanceDefaultPaste: boolean;
  thumbnailPosition: "left" | "right";
  downloadImages: boolean;
  downloadFavicons: boolean;
  imageFolder: string;
  faviconFolder: string;
  cardStyle: "classic" | "modern" | "glass" | "compact";
}

export const DEFAULT_SETTINGS: ObsidianAutoCardLinkSettings = {
  showInMenuItem: true,
  enhanceDefaultPaste: false,
  thumbnailPosition: "left",
  downloadImages: false,
  downloadFavicons: false,
  imageFolder: "AutoCardLink",
  faviconFolder: "AutoCardLink/favicons",
  cardStyle: "classic",
};

export class ObsidianAutoCardLinkSettingTab extends PluginSettingTab {
  plugin: ObsidianAutoCardLink;

  constructor(app: App, plugin: ObsidianAutoCardLink) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- General ---
    new Setting(containerEl).setName("General").setHeading();

    new Setting(containerEl)
      .setName("Enhance Default Paste")
      .setDesc("Fetch the link metadata when pasting a url in the editor with the default paste command")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.enhanceDefaultPaste)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.enhanceDefaultPaste = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Add commands in menu item")
      .setDesc("Whether to add commands in right click menu items")
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

    // --- Images ---
    new Setting(containerEl).setName("Images").setHeading();

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
          .setPlaceholder("AutoCardLink")
          .setValue(this.plugin.settings.imageFolder)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.imageFolder = value.trim() || "AutoCardLink";
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
            this.plugin.settings.cardStyle = value as "classic" | "modern" | "compact";
            await this.plugin.saveSettings();
            applyCardStyle(this.plugin.settings.cardStyle);
          });
      });

    new Setting(containerEl)
      .setName("Thumbnail position")
      .setDesc("Which side of the card the thumbnail appears on")
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
  }
}

export function applyThumbnailPosition(position: "left" | "right"): void {
  document.body.classList.toggle(
    "auto-card-link-thumbnail-right",
    position === "right"
  );
}

export function applyCardStyle(style: "classic" | "modern" | "glass" | "compact"): void {
  document.body.classList.remove(
    "auto-card-link-style-modern",
    "auto-card-link-style-glass",
    "auto-card-link-style-compact"
  );
  if (style !== "classic") document.body.classList.add(`auto-card-link-style-${style}`);
}