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

  public static isGitLabUrl(url: string): boolean {
    // gitlab.com project pages only (`<namespace>/<project>`, groups may nest deeper).
    // A path carrying GitLab's `/-/` infix is an issue, MR, file or tree view — those read
    // fine on the generic path. A single segment is a user or group landing page, not a
    // project. Reserved top-level routes aren't projects either. Anything that slips through
    // (a group URL two segments deep, a typo) 404s the API and falls back to generic.
    const m = url.match(/^https?:\/\/(www\.)?gitlab\.com\/([^?#]+)/i);
    const path = m?.[2]?.replace(/\/+$/, "");
    if (!path || !path.includes("/") || path.includes("/-/")) return false;
    return !/^(-|help|explore|dashboard|groups|projects|users|api|admin|search|sitemap)(\/|$)/i.test(path);
  }

  public static isGoodreadsUrl(url: string): boolean {
    // Book pages only, and not to fetch them differently — they read perfectly on the
    // generic path. It is the *missing* book that needs handling: Goodreads answers one
    // with 200 and its own not-found furniture. Author, list and shelf pages are left alone.
    return /^https?:\/\/(www\.)?goodreads\.com\/book\/show\//i.test(url);
  }

  public static isMediumUrl(url: string): boolean {
    // Article pages, including the `<publication>.medium.com` subdomain form. Medium reads
    // fine on the generic path — this is only so a *removed* article can be recognised, since
    // Medium answers one with 200 and a page titled just "Medium". Publications on their own
    // domain are unrecognisable, same limit as Substack.
    return /^https?:\/\/([a-z0-9-]+\.)?medium\.com\/[^/?#]/i.test(url);
  }

  public static isNpmUrl(url: string): boolean {
    // A package page, scoped or not, with or without a trailing `/v/<version>`. Every other
    // npmjs.com route (search, orgs, profiles) reads fine on the generic path and has nothing
    // the registry API could answer for anyway, so it stays there.
    return /^https?:\/\/(www\.)?npmjs\.com\/package\/[^/?#]/i.test(url);
  }

  public static isNotionUrl(url: string): boolean {
    // A published Notion page: `notion.so` and every workspace's own `*.notion.site`.
    // `notion.com` - the marketing site, which `notion.so/product` and friends redirect to -
    // is an ordinary server-rendered page and stays on the generic path.
    return /^https?:\/\/([a-z0-9-]+\.)?notion\.site(\/|$|[?#])/i.test(url)
      || /^https?:\/\/(www\.)?notion\.so(\/|$|[?#])/i.test(url);
  }

  public static isDiscordUrl(url: string): boolean {
    // Only the two forms that break on the generic path. An invite (`discord.gg/<code>`, or
    // its `discord.com/invite/<code>` long form) and a link into a server
    // (`discord.com/channels/…`) both answer 200 with Discord's marketing shell when they
    // cannot be shown, which is a card that says the wrong thing rather than nothing.
    // Everything else on discord.com - /download, /blog, /nitro - is an ordinary page with
    // its own og tags and stays generic.
    return /^https?:\/\/(www\.)?discord\.gg\/[^/?#]/i.test(url)
      || /^https?:\/\/(www\.)?(discord|discordapp)\.com\/(invite\/[^/?#]|channels\/)/i.test(url);
  }

  public static isSteamUrl(url: string): boolean {
    // A store app page only: `/app/<id>` and the `/agecheck/app/<id>` form a mature title
    // redirects to. A live app reads fine on the generic path; this exists so a *missing*
    // app id, which Steam answers with a 302 to its own storefront (og:title "Steam Store"),
    // does not become a confident card advertising the store. Bundles, subs, community
    // profiles, news and search carry their own og tags and stay generic.
    return /^https?:\/\/store\.steampowered\.com\/(agecheck\/)?app\/\d+/i.test(url);
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

  public static isBlueskyUrl(url: string): boolean {
    // A post or a profile. The handle may also be a raw DID, which the API accepts as-is.
    return /^https?:\/\/bsky\.app\/profile\/[^/?#]+/i.test(url);
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
