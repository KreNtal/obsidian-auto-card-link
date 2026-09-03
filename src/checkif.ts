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
    return /^https?:\/\/(www\.)?(youtube\.com\/(watch|shorts\/|playlist\?|@|c\/|channel\/)|youtu\.be\/)/.test(url);
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

  public static isXUrl(url: string): boolean {
    return /^https?:\/\/(www\.|mobile\.|m\.)?(twitter|x)\.com\//.test(url);
  }

  public static isImdbUrl(url: string): boolean {
    return /imdb\.com\//.test(url);
  }

  public static isPrintablesUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?printables\.com\//.test(url);
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

  public static isArxivUrl(url: string): boolean {
    // A paper, or the site root — the homepage carries no og:* tags at all, so it needs the
    // dedicated path just to get a thumbnail.
    return /^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf|format|html)\//i.test(url)
      || /^https?:\/\/(www\.)?arxiv\.org\/?([?#]|$)/i.test(url);
  }

  public static isHackerNewsUrl(url: string): boolean {
    // Only the two routes the API can answer for. /newest, /front and the front page carry
    // nothing an API call improves on, so they stay generic.
    return /^https?:\/\/news\.ycombinator\.com\/(item|user)\?id=/i.test(url);
  }

  public static isLinkedInUrl(url: string): boolean {
    // Any LinkedIn page, including the country subdomains (it.linkedin.com) the share
    // buttons hand out.
    return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com(\/|$|[?#])/i.test(url);
  }

  private static readonly SE_HOST = "(www\\.)?([a-z-]+\\.)?(stackoverflow|serverfault|superuser|askubuntu|stackapps|stackexchange)\\.com|mathoverflow\\.net";

  public static isStackExchangeUrl(url: string): boolean {
    // A question or answer on any Stack Exchange network site. Other paths (tags, users)
    // carry nothing an API call improves on, so they stay on the generic path.
    const qa = new RegExp(`^https?://(${CheckIf.SE_HOST})/(questions/\\d+|q/\\d+|a/\\d+)`, "i");
    return qa.test(url) || CheckIf.isStackExchangeSiteUrl(url);
  }

  /**
   * The front page of a network site. It 403s every non-browser request, so the generic path
   * can only reach it through microlink; the `/2.3/sites` endpoint describes all 365 of them
   * in one call and answers regardless.
   */
  public static isStackExchangeSiteUrl(url: string): boolean {
    return new RegExp(`^https?://(${CheckIf.SE_HOST})/?([?#]|$)`, "i").test(url);
  }
}
