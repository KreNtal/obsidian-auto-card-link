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

  public static isKickUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?kick\.com\/[^/?#]/i.test(url);
  }

  public static isRumbleVideoUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?rumble\.com\/(v[a-z0-9]+-[^/?#]*\.html|embed\/v[a-z0-9]+)/i.test(url);
  }

  public static isOdyseeClaimUrl(url: string): boolean {
    // A channel or a video - any path but the app's own `/$/` routes, which are titled "Odysee"
    // alive (`/$/trending`, `/$/discover`).
    return /^https?:\/\/(www\.)?odysee\.com\/(?!\$|%24)[^/?#]/i.test(url);
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

  public static isBitbucketRepoUrl(url: string): boolean {
    // A repository and every page under it: `/src/`, `/commits/`, `/pull-requests/<id>` all
    // answer the identical client-rendered shell, `<title>Bitbucket</title>` and no og:* at
    // all (measured 2026-09-16). A single segment is a workspace, which anonymously is a real
    // 404 and stays generic, as do the product, account and blog routes.
    const m = url.match(/^https?:\/\/(www\.)?bitbucket\.org\/([^/?#]+)\/[^/?#]+/i);
    return !!m && !/^(product|account|dashboard|snippets|blog|site|repo|support|legal|socialauth|api|search|invitations)$/i.test(m[2]!);
  }

  public static isGoodreadsUrl(url: string): boolean {
    // Book pages only, and not to fetch them differently — they read perfectly on the
    // generic path. It is the *missing* book that needs handling: Goodreads answers one
    // with 200 and its own not-found furniture. Author, list and shelf pages are left alone.
    return /^https?:\/\/(www\.)?goodreads\.com\/book\/show\//i.test(url);
  }

  public static isGogGameUrl(url: string): boolean {
    // Game pages only, with or without the language segment. Like Goodreads, only so a
    // *missing* game can be recognised: GOG redirects one to its catalog with a 200.
    return /^https?:\/\/(www\.)?gog\.com\/([a-z]{2}\/)?game\/[^/?#]+/i.test(url);
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

  public static isDockerHubRepoUrl(url: string): boolean {
    // A `/r/<namespace>/<name>` repository page only, `/tags` and the other tabs included.
    // Official images (`/_/<name>`) declare a real description and read fine, `/u/` profiles
    // and everything else likewise, so they stay on the generic path.
    return /^https?:\/\/hub\.docker\.com\/r\/[^/?#]+\/[^/?#]+/i.test(url);
  }

  public static isCratesIoCrateUrl(url: string): boolean {
    // A crate, its tabs and a version under it. Every crates.io route answers the same shell,
    // but only a crate has an endpoint worth asking; users, keywords and the rest stay generic.
    return /^https?:\/\/(www\.)?crates\.io\/crates\/[^/?#]+/i.test(url);
  }

  public static isRubyGemsGemUrl(url: string): boolean {
    // A gem page, with or without `/versions/<version>`. Profiles and search stay generic.
    return /^https?:\/\/(www\.)?rubygems\.org\/gems\/[^/?#]+/i.test(url);
  }

  public static isHashnodeProfileOrTagUrl(url: string): boolean {
    // hashnode.com's own profile and tag pages, which answer a missing one with a 200. Posts
    // live on the blogs (`*.hashnode.dev`, custom domains) and are a real 404 when gone.
    return /^https?:\/\/(www\.)?hashnode\.com\/(@|n\/|tag\/)[^/?#]+\/?([?#]|$)/i.test(url);
  }

  public static isPackagistPackageUrl(url: string): boolean {
    // `/packages/<vendor>/<name>` only: a missing one redirects to search with a 200.
    return /^https?:\/\/(www\.)?packagist\.org\/packages\/[^/?#]+\/[^/?#]+/i.test(url);
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

  public static isFacebookUrl(url: string): boolean {
    // The whole domain: a real page reads generically and is untouched, and the shell check
    // in fetchFacebook only ever fires on the exact bare-title, no-description shape, so a
    // broad match here costs nothing on any route it doesn't apply to (2026-09-22).
    return /^https?:\/\/(www\.|m\.)?facebook\.com\//i.test(url);
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

  public static isOpenStreetMapUrl(url: string): boolean {
    // A specific map object - a node, way or relation. Its og:description and og:image are
    // the same for every object, so the public API supplies a description (field rule
    // A1(d)); everything else is the page's. A bare map view (`/#map=…`) carries no
    // server-visible location and stays generic.
    return /^https?:\/\/(www\.)?(openstreetmap\.org|osm\.org)\/(node|way|relation)\/\d+/i.test(url);
  }

  public static isEpicProductUrl(url: string): boolean {
    // `/p/<slug>`, with or without the locale segment. Read generically; only a *missing*
    // product needs recognising, since Epic answers one with a 200.
    return /^https?:\/\/store\.epicgames\.com\/([a-z]{2}(-[a-z]{2})?\/)?p\/[^/?#]+\/?([?#]|$)/i.test(url);
  }

  public static isEtsyUrl(url: string): boolean {
    // The whole host: Etsy refuses every ordinary request, and the WhatsApp UA that gets
    // through works on listings, shops, categories and the localised home page alike.
    return /^https?:\/\/(www\.)?etsy\.com(\/|$)/i.test(url);
  }

  public static isYelpBizUrl(url: string): boolean {
    // A business on the two hosts DataDome guards; the other national hosts read as they are.
    return /^https?:\/\/(www\.)?yelp\.(com|ca)\/biz\/[^/?#]+/i.test(url);
  }

  public static isTripAdvisorReviewUrl(url: string): boolean {
    // A place's page on any national host - `Hotel_Review-`, `Restaurant_Review-`,
    // `Attraction_Review-`, … `-g<geo>-d<id>-Reviews-<Name>-<Place>.html` - checked 2026-09-21.
    return /^https?:\/\/(www\.)?tripadvisor\.[a-z.]+\/\w+_Review-g\d+-d\d+-Reviews-/i.test(url);
  }

  public static isEbayUrl(url: string): boolean {
    // Every eBay marketplace (ebay.com, ebay.it, ebay.co.uk, …): Akamai refuses them all the
    // same way, and the request that gets through works on items, search and the home page.
    return /^https?:\/\/(www\.|m\.)?ebay\.[a-z]{2,3}(\.[a-z]{2})?(\/|$)/i.test(url);
  }

  public static isAliExpressItemUrl(url: string): boolean {
    // `/item/<id>.html`, on www. or a country subdomain (it., es., …). Read generically; only
    // a *missing* item needs recognising, since AliExpress answers one with a 200.
    return /^https?:\/\/([a-z]{2,3}\.)?aliexpress\.com\/item\/\d+\.html/i.test(url);
  }

  public static telegramHandle(url: string): { handle: string; post?: string } | undefined {
    // `t.me/<handle>` and `t.me/<handle>/<n>`, also on telegram.me. A username is 5-32
    // characters, so the app's short routes (`/s/`, `/c/<id>/<n>`, `/+<invite>`) never match;
    // the longer ones (`/joinchat/`, `/addstickers/`) match but never meet either check.
    const m = url.match(/^https?:\/\/(?:www\.)?(?:t|telegram)\.me\/([a-z]\w{3,31})(?:\/(\d+))?\/?(?:[?#]|$)/i);
    return m?.[1] ? { handle: m[1], post: m[2] } : undefined;
  }

  public static isPinterestUrl(url: string): boolean {
    // The whole host, www. or a country subdomain (it., uk.), and the country domains
    // (pinterest.de, pinterest.co.uk), which redirect to those subdomains. Read generically;
    // only a *missing* pin, profile or board needs recognising, since Pinterest answers one
    // with a 200 - checked 2026-09-22.
    return /^https?:\/\/([a-z]{2,3}\.)?pinterest\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})([/?#]|$)/i.test(url);
  }

  public static isItchGameUrl(url: string): boolean {
    // `<creator>.itch.io/<slug>` and nothing deeper: a game, tool or asset page, the shape
    // titled "<title> by <creators>". Profiles, devlogs and itch.io itself stay generic.
    return /^https?:\/\/[a-z0-9-]+\.itch\.io\/[^/?#]+\/?([?#]|$)/i.test(url);
  }

  public static isGooglePlayIdUrl(url: string): boolean {
    // The shapes that name their item only in `?id=`: an app, a book, a developer by name
    // or by number. They read fine generically; only a dead one needs its title from the id.
    return /^https?:\/\/play\.google\.com\/store\/(apps|books)\/(details|dev|developer)\?(.*&)?id=/i.test(url);
  }

  public static isHuggingFaceRepoUrl(url: string): boolean {
    // A model (`/<owner>/<name>`), dataset or Space root. Tabs, files and discussions carry
    // titles of their own and stay generic, and so do the two-segment routes that are not
    // repos (`/blog/<slug>`, `/papers/<id>`, `/docs/<lib>`, …).
    return /^https?:\/\/(www\.)?(huggingface|hf)\.co\/(datasets\/|spaces\/|(?!(blog|docs|papers|learn|tasks|posts|collections|organizations|settings|models|datasets|spaces|api|chat|join|new)\/))[^/?#]+\/[^/?#]+\/?([?#]|$)/i.test(url);
  }

  public static isApplePodcastsUrl(url: string): boolean {
    // The whole host: a show or episode already reads fine generically, and this only adds
    // the show's own name to an episode as `author` - a no-op everywhere else. Checked
    // 2026-09-10.
    return /^https?:\/\/podcasts\.apple\.com\//i.test(url);
  }

  public static isAniListUrl(url: string): boolean {
    // The whole host, not a route. Every anilist.co URL - a live anime, a manga, a user, an
    // id that cannot exist - answers the identical 5 KB client-rendered shell:
    // `<title>AniList</title>`, og:site_name, and no other og:* tag at all. So no page on
    // this site can be read (field rule A1(a), measured 2026-09-15), and the generic path
    // would write a card titled "AniList" for every one of them.
    return /^https?:\/\/(www\.)?anilist\.co\//i.test(url);
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
    // /maps/search/<query>/…, and a bare ?q=<query> on either host Maps answers to - plus
    // a maps.app.goo.gl share link, whose name lives on the page it redirects to rather
    // than in the URL (2026-09-22). The legacy goo.gl/maps/<token> shortener is gone: it
    // answers every token, real or not, with a plain 404 and no Location header.
    return /^https?:\/\/(www\.|maps\.)?google\.[a-z.]{2,}\/maps\/(place|search)\/[^/?#]+/i.test(url)
      || /^https?:\/\/(www\.)?google\.[a-z.]{2,}\/maps\/?\?[^#]*\bq=/i.test(url)
      || /^https?:\/\/maps\.google\.[a-z.]{2,}\/(maps\/?)?\?[^#]*\bq=/i.test(url)
      || CheckIf.isGoogleMapsShortUrl(url);
  }

  public static isGoogleMapsShortUrl(url: string): boolean {
    return /^https?:\/\/maps\.app\.goo\.gl\/[^/?#]+/i.test(url);
  }

  public static isTrelloBoardUrl(url: string): boolean {
    // A board only. Every Trello route - a board, a card, the marketing pages - serves the
    // identical client-rendered shell to a non-browser request (title "Trello", a generic
    // "Organize anything, together" blurb, no og tags at all), but a board alone has a
    // public, unauthenticated JSON export (`.json` on its own URL) that a card's `/c/`
    // route does not share - checked 2026-09-10.
    return /^https?:\/\/trello\.com\/b\/[^/?#]+/i.test(url);
  }

  public static isTrelloCardUrl(url: string): boolean {
    // A card, `/c/<shortLink>[/<n>-<slug>]`: the same shell as a board, read through the
    // REST API instead - checked 2026-09-17.
    return /^https?:\/\/trello\.com\/c\/[A-Za-z0-9]+/i.test(url);
  }

  public static isJiraCloudIssueUrl(url: string): boolean {
    // A Jira Cloud issue, `<site>.atlassian.net/browse/<KEY>-<n>`: every one - live, missing
    // or private - answers the same shell titled "Jira", read through the REST API instead -
    // checked 2026-09-18. Boards, filters, `/wiki/` (Confluence) and self-hosted Jira stay
    // generic.
    return /^https?:\/\/[a-z0-9-]+\.atlassian\.net\/browse\/[a-z][a-z0-9_]*-\d+\/?([?#]|$)/i.test(url);
  }

  public static isJiraServerIssueUrl(url: string): boolean {
    // Self-hosted Jira on any host, `<base>/browse/<KEY>-<n>`, the base allowed a context path
    // (`issues.apache.org/jira`). Checked last in the dispatch: the handler reads the page first
    // and asks Jira's API only when the title is not Jira's "[KEY] summary" - checked 2026-09-18.
    return /^https?:\/\/[^/?#]+(\/[^?#]*)?\/browse\/[a-z][a-z0-9_]*-\d+\/?([?#]|$)/i.test(url);
  }

  public static isConfluenceCloudUrl(url: string): boolean {
    // Confluence Cloud, `<site>.atlassian.net/wiki/...`: a live page reads, but a missing page
    // or space is a 200 titled "Page Not Found - Confluence" and a site closed to anonymous
    // readers a 401 - checked 2026-09-18. Self-hosted Confluence answers a real 404.
    return /^https?:\/\/[a-z0-9-]+\.atlassian\.net\/wiki([/?#]|$)/i.test(url);
  }

  public static isLinearUrl(url: string): boolean {
    // The whole host: every workspace route - an issue, a project, a document, the workspace
    // itself, live or not - answers the same shell titled "Linear", while the marketing and
    // docs pages carry og tags and read - checked 2026-09-18. The check runs on the result.
    return /^https?:\/\/(www\.)?linear\.app([/?#]|$)/i.test(url);
  }

  public static isClickUpAppUrl(url: string): boolean {
    // The app and its two public-link hosts: a task (`app.clickup.com/t/…`), a public doc
    // (`doc.clickup.com`), a public task or view (`sharing.clickup.com`) - every one the same
    // shell, public or not - checked 2026-09-18. clickup.com and help.clickup.com read.
    return /^https?:\/\/(app|doc|sharing)\.clickup\.com([/?#]|$)/i.test(url);
  }

  public static isCodaDocUrl(url: string): boolean {
    // A Coda doc, `/d/<Doc-Name>_d<id>[/<Page>_su<id>]`, on coda.io or on docs.superhuman.com,
    // where coda.io now redirects: a doc shared publicly reads, a private or missing one lands
    // on Superhuman's sign-in page - checked 2026-09-18. Published docs (`/@<user>/…`) read
    // and answer a missing one with a real 404.
    return /^https?:\/\/(www\.)?(coda\.io|docs\.superhuman\.com)\/d\/[^/?#]+/i.test(url);
  }

  public static isJsfiddleShowUrl(url: string): boolean {
    // A fiddle's result view, `[/<user>]/<id>[/<version>]/show[/]`: every live one redirects to
    // the sign-in page, a missing one is a real 404 - checked 2026-09-22. The fiddle's own
    // page, without `/show/`, reads.
    return /^https?:\/\/(www\.)?jsfiddle\.net(\/[\w-]+){1,3}\/show\/?([?#]|$)/i.test(url);
  }

  public static isReplitProfileUrl(url: string): boolean {
    // A profile, `/@<user>[/][?tab=…]`: every one that exists redirects to the sign-up page, a
    // missing one is a real 404 - checked 2026-09-22. A repl, `/@<user>/<repl>`, reads.
    return /^https?:\/\/(www\.)?replit\.com\/@[\w.-]+\/?([?#]|$)/i.test(url);
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

  public static isEnWiktionaryEntryUrl(url: string): boolean {
    return /^https?:\/\/en\.(m\.)?wiktionary\.org\/wiki\/[^?#]/i.test(url);
  }

  public static isArxivUrl(url: string): boolean {
    // A paper, or the site root — the homepage carries no og:* tags at all, so it needs the
    // dedicated path just to get a thumbnail.
    return /^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf|format|html)\//i.test(url)
      || /^https?:\/\/(www\.)?arxiv\.org\/?([?#]|$)/i.test(url);
  }

  public static isDoiUrl(url: string): boolean {
    // A DOI, never the resolver's own pages: every DOI starts "10." (ISO 26324), and the
    // homepage is a readable page like any other.
    return /^https?:\/\/(dx\.|www\.)?doi\.org\/10\.\d+\//i.test(url);
  }

  public static isPubMedArticleUrl(url: string): boolean {
    // An article, /<PMID>/. Live and dead ids alike answer the same 203 proof-of-work page,
    // "Cookies must be enabled", with no tag about the article (measured 2026-09-18).
    return /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/?([?#]|$)/i.test(url);
  }

  public static isBiorxivPreprintUrl(url: string): boolean {
    // A preprint, /content/10.1101/<id>[v<n>][.full…]. Live and dead ones alike are 302'd by
    // Cloudflare to /node/, a page titled "| bioRxiv" (measured 2026-09-18).
    return /^https?:\/\/(www\.)?biorxiv\.org\/content\/10\.1101\/\d/i.test(url);
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
