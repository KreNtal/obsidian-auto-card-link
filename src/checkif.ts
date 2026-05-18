import { urlRegex, linkRegex, imageRegex } from "./regex";

export class CheckIf {
  public static isUrl(text: string): boolean {
    const regex = new RegExp(urlRegex);
    return regex.test(text);
  }

  public static isImage(text: string): boolean {
    const regex = new RegExp(imageRegex);
    return regex.test(text);
  }

  public static isLinkedUrl(text: string): boolean {
    const regex = new RegExp(linkRegex);
    return regex.test(text);
  }

  public static isYouTubeUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?(youtube\.com\/(watch|shorts\/)|youtu\.be\/)/.test(url);
  }

  public static isVimeoUrl(url: string): boolean {
    return /^https?:\/\/(www\.|player\.)?vimeo\.com\//.test(url);
  }

  public static isDailymotionUrl(url: string): boolean {
    return /^https?:\/\/(www\.dailymotion\.com\/video\/|dai\.ly\/)/.test(url);
  }

  public static isTwitchUrl(url: string): boolean {
    return /^https?:\/\/(www\.twitch\.tv\/\w|clips\.twitch\.tv\/)/.test(url);
  }

  public static isTedUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?ted\.com\/talks\//.test(url);
  }

  public static isRedditUrl(url: string): boolean {
    return /reddit\.com\/(r|u|user)\//.test(url);
  }

  public static isImdbUrl(url: string): boolean {
    return /imdb\.com\//.test(url);
  }

  public static isGitHubUrl(url: string): boolean {
    // Only match repo root URLs (owner/repo with no deeper path segments)
    // Issues, PRs, code etc. are better handled by fetchGeneric
    return /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/?#]+(\/)?([?#].*)?$/.test(url);
  }

  public static isSpotifyUrl(url: string): boolean {
    return /^https?:\/\/open\.spotify\.com\/(intl-[a-z]+\/)?(track|album|playlist|artist|episode)\//.test(url);
  }

  public static isWikipediaUrl(url: string): boolean {
    return /^https?:\/\/[a-z]{2,}\.wikipedia\.org\/wiki\//.test(url);
  }
}
