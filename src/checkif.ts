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

  public static isBandcampUrl(url: string): boolean {
    // An album or track on any artist's own subdomain. A live one already reads fine
    // generically - this exists only so Cloudflare's interstitial, when it shows up, is
    // recognised rather than accepted as the page. Checked 2026-09-10.
    return /^https?:\/\/[a-z0-9-]+\.bandcamp\.com\/(track|album)\//i.test(url);
  }

  public static isSoundCloudResourceUrl(url: string): boolean {
    // A track, set or repost - any two-segment soundcloud.com path. A profile page (one
    // segment) already reads fine generically and is left alone. Not scoped further than
    // that: a two-segment path that isn't a real resource is exactly the case this exists
    // for, and one that happens to be a reserved route (rare, and already broken the same
    // way if it 200s the shell) only gets an honest URL-built title instead of a wrong one.
    // `on.soundcloud.com/<code>` - the share-sheet's short link - 302s straight to one of
    // these; matched here too so it gets the same author extraction, not just the generic
    // path's og:* read of wherever it lands.
    return /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[^/?#]+\/[^/?#]+/i.test(url)
      || /^https?:\/\/on\.soundcloud\.com\/[^/?#]+/i.test(url);
  }

  public static isApplePodcastsUrl(url: string): boolean {
    // The whole host: a show or episode already reads fine generically, and this only adds
    // the show's own name to an episode as `author` - a no-op everywhere else. Checked
    // 2026-09-10.
    return /^https?:\/\/podcasts\.apple\.com\//i.test(url);
  }

  public static isGoogleDocsUrl(url: string): boolean {
    // Docs, Sheets, Slides and Drive files/folders. A public one reads fine generically -
    // real og:title, description, thumbnail - so this exists only for the other case: a
    // file or folder shared with specific people rather than "anyone with the link"
    // redirects an anonymous request to Google's own sign-in page. Checked 2026-09-10.
    return /^https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/[^/?#]+/i.test(url)
      || /^https?:\/\/drive\.google\.com\/(file\/d\/[^/?#]+|drive\/folders\/[^/?#]+)/i.test(url);
  }

  public static isGoogleMapsUrl(url: string): boolean {
    // Every Maps page - a real place, a search, or one that cannot exist - declares
    // og:title "Google Maps" and nothing else names what was pasted; only the URL does.
    // Scoped to the shapes that carry a name or query there: /maps/place/<name>/…,
    // /maps/search/<query>/…, and a bare ?q=<query> on either host Maps answers to. A
    // goo.gl / maps.app.goo.gl share link carries no name at all - a separate, unresolved
    // gap - and stays generic.
    return /^https?:\/\/(www\.|maps\.)?google\.[a-z.]{2,}\/maps\/(place|search)\/[^/?#]+/i.test(url)
      || /^https?:\/\/(www\.)?google\.[a-z.]{2,}\/maps\/?\?[^#]*\bq=/i.test(url)
      || /^https?:\/\/maps\.google\.[a-z.]{2,}\/(maps\/?)?\?[^#]*\bq=/i.test(url);
  }

  public static isTrelloBoardUrl(url: string): boolean {
    // A board only. Every Trello route - a board, a card, the marketing pages - serves the
    // identical client-rendered shell to a non-browser request (title "Trello", a generic
    // "Organize anything, together" blurb, no og tags at all), but a board alone has a
    // public, unauthenticated JSON export (`.json` on its own URL) that a card's `/c/`
    // route does not share - checked 2026-09-10.
    return /^https?:\/\/trello\.com\/b\/[^/?#]+/i.test(url);
  }

  public static isTikTokUrl(url: string): boolean {
    // A creator profile (`@handle`) or a single video (`@handle/video/<id>`) - the two
    // routes TikTok's oEmbed can answer. Anything past that (`/photo/`, `/live`, a tag,
    // discover, search) is deliberately left unmatched rather than half-handled: it still
    // hits the same login wall on the generic path, a separate gap.
    return /^https?:\/\/(www\.)?tiktok\.com\/@[^/?#]+(\/video\/\d+)?\/?([?#]|$)/i.test(url);
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
