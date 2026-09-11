import { Notice, requestUrl } from "obsidian";
import {
   BlueskyPost,
   BlueskyProfile,
   HackerNewsItem,
   HackerNewsUser,
   DailymotionVideoResponse, GitHubRepoResponse, GitLabProjectResponse, ImdbSuggestionResponse, LinkMetadata, MicrolinkResponse, NpmPackageResponse, OEmbedResponse,
   OsmElementResponse,
   PrintablesGraphQLResponse, StackExchangeSite, SteamAppDetailsResponse, TikTokOEmbedResponse, TrelloBoardResponse, WikipediaSummaryResponse, XSyndicationResponse
} from "./interfaces";
import { LinkMetadataParser } from "./link_metadata_parser";
import { CheckIf } from "./checkif";
import { ObsidianAutoCardLinkSettings } from "./settings";

export class LinkMetadataFetcher {
   private settings?: ObsidianAutoCardLinkSettings;

   /**
    * Reddit's feed is the one endpoint here with a budget tight enough to feel: one request
    * per clock minute, per IP. Both are static so they outlive the short-lived instance made
    * for each conversion, and hold for the session only - nothing is written to disk.
    */
   private static readonly redditFeedCache = new Map<string, LinkMetadata>();
   private static redditFeedBlockedUntil = 0;
   private static readonly REDDIT_POST_URL = /reddit\.com\/r\/\w+\/comments\//i;
   private static readonly REDDIT_SUBREDDIT_URL = /reddit\.com\/r\/\w+/i;

   constructor(settings?: ObsidianAutoCardLinkSettings) {
      this.settings = settings;
   }

   async fetch(url: string, options?: { refresh?: boolean; previous?: LinkMetadata; }): Promise<LinkMetadata | undefined> {
      url = url.trim().replace(/^["']|["']$/g, "");
      if (url.startsWith("http://")) url = "https://" + url.slice(7);
      url = this.stripCloudflareChallenge(url);

      const metadata = await this.fetchForUrl(url, options?.refresh ?? false);
      if (!metadata) return metadata;
      return this.normalizeHost(
         this.withSiteName(this.keepSupplements(metadata, options?.previous), url)
      );
   }

   /**
    * Drops a leading `www.` from the host the card displays.
    *
    * Three places set that field and none of them agreed. The generic path copies the URL's
    * own hostname, so the card ended up mirroring how the link happened to be written rather
    * than which site it is; the dedicated fetchers each hardcode a literal, split roughly in
    * half between the two forms; the newest of them strip the prefix outright. Settling it
    * here rather than in the twelve literals is what stops the two paths drifting apart again
    * the next time a fetcher is added.
    *
    * Only the leading `www.` goes - `open.spotify.com`, `en.wikipedia.org` and
    * `clips.twitch.tv` say something the card should keep. Nothing reads `host` for
    * behaviour (siteNameFor normalises it away already, the Google favicon fallback takes
    * either form), so this is display only. It is also written into the block, so existing
    * cards keep whatever they were given until they are refreshed.
    */
   private normalizeHost(metadata: LinkMetadata): LinkMetadata {
      if (!metadata.host) return metadata;
      const host = metadata.host.replace(/^www\./i, "");
      return host === metadata.host ? metadata : { ...metadata, host };
   }

   /**
    * A refresh must never cost the card a field it already had.
    *
    * `title`, `host` and `author` are rebuilt every time from the URL or from an endpoint with
    * no meaningful budget. `description` and `image` don't work that way: they come from
    * best-effort sources with hard limits - Reddit's one-request-per-minute feed, microlink's
    * daily quota - and from pages that simply fail to load, ending at fetchTitleOnly. When one
    * of those comes up empty the fetch does not fail, it just returns without the field, and
    * rewriting the block from that result would delete it. A card is a note in the vault
    * rather than a live mirror, so the older value is worth more than an empty slot.
    *
    * Only an *absent* field is filled in, so a source that genuinely changed its description
    * still wins the refresh. A source answering with a poorer value rather than none is
    * therefore not covered - e.g. GitHub's page scrape standing in for its rate-limited API
    * carries an og:description, so it overwrites the richer "desc · language · ★ stars" line.
    *
    * `previous` is only ever supplied by the refresh path (parsed from the very block being
    * replaced), so a first conversion is unaffected.
    */
   private keepSupplements(metadata: LinkMetadata, previous?: LinkMetadata): LinkMetadata {
      if (!previous) return metadata;
      return {
         ...metadata,
         description: metadata.description ?? previous.description,
         // Possibly a "[[wikilink]]" to an already-downloaded copy, which is exactly what the
         // block should keep saying - fetchLinkMetadata only re-downloads a plain URL.
         image: metadata.image ?? previous.image,
      };
   }

   private async fetchForUrl(url: string, refresh: boolean): Promise<LinkMetadata | undefined> {
      if (CheckIf.isYouTubeUrl(url)) return this.fetchYouTube(url);
      if (CheckIf.isVimeoUrl(url)) return this.fetchVimeo(url);
      if (CheckIf.isDailymotionUrl(url)) return this.fetchDailymotion(url);
      if (CheckIf.isTwitchUrl(url)) return this.fetchTwitch(url);
      if (CheckIf.isTedUrl(url)) return this.fetchTed(url);
      if (CheckIf.isRedditUrl(url)) return this.fetchReddit(url, refresh);
      if (CheckIf.isXUrl(url)) return this.fetchX(url);
      if (CheckIf.isImdbUrl(url)) return this.fetchImdb(url);
      if (CheckIf.isPrintablesUrl(url)) return this.fetchPrintables(url);
      if (CheckIf.isGitHubUrl(url)) return this.fetchGitHub(url, refresh);
      if (CheckIf.isGitLabUrl(url)) return this.fetchGitLab(url, refresh);
      if (CheckIf.isNpmUrl(url)) return this.fetchNpm(url, refresh);
      if (CheckIf.isGoodreadsUrl(url)) return this.fetchGoodreads(url);
      if (CheckIf.isTikTokUrl(url)) return this.fetchTikTok(url);
      if (CheckIf.isSteamUrl(url)) return this.fetchSteam(url, refresh);
      if (CheckIf.isTrelloBoardUrl(url)) return this.fetchTrello(url, refresh);
      if (CheckIf.isGoogleMapsUrl(url)) return this.fetchGoogleMaps(url);
      if (CheckIf.isGoogleDocsUrl(url)) return this.fetchGoogleDocs(url);
      if (CheckIf.isSoundCloudResourceUrl(url)) return this.fetchSoundCloud(url);
      if (CheckIf.isBandcampUrl(url)) return this.fetchBandcamp(url);
      if (CheckIf.isApplePodcastsUrl(url)) return this.fetchApplePodcasts(url);
      if (CheckIf.isOpenStreetMapUrl(url)) return this.fetchOpenStreetMap(url, refresh);
      if (CheckIf.isMediumUrl(url)) return this.fetchMedium(url);
      if (CheckIf.isSpotifyUrl(url)) return this.fetchSpotify(url);
      if (CheckIf.isWikipediaUrl(url)) return this.fetchWikipedia(url);
      if (CheckIf.isArxivUrl(url)) return this.fetchArxiv(url);
      if (CheckIf.isStackExchangeUrl(url)) return this.fetchStackExchange(url);
      if (CheckIf.isLinkedInUrl(url)) return this.fetchLinkedIn(url);
      if (CheckIf.isNotionUrl(url)) return this.fetchNotion(url);
      if (CheckIf.isDiscordUrl(url)) return this.fetchDiscord(url);
      if (CheckIf.isHackerNewsUrl(url)) return this.fetchHackerNews(url);
      if (CheckIf.isBlueskyUrl(url)) return this.fetchBluesky(url);

      return this.fetchGeneric(url);
   }

   /**
    * Display names for sites that cannot tell us their own.
    *
    * Mostly the dedicated fetchers: they answer from an API or oEmbed and never look at the
    * page HTML, so there is no og:site_name to read, and deriving a name from the hostname
    * would get the capitalisation wrong ("Youtube", "Imdb", "Github").
    *
    * A site on the generic path belongs here only when it genuinely omits the tag. A name
    * the page declares always wins over this map, so an entry is a floor, not an override.
    */
   private static readonly SITE_NAMES: Record<string, string> = {
      "youtube.com": "YouTube",
      "youtu.be": "YouTube",
      "vimeo.com": "Vimeo",
      "dailymotion.com": "Dailymotion",
      "twitch.tv": "Twitch",
      "ted.com": "TED",
      "reddit.com": "Reddit",
      "imdb.com": "IMDb",
      "printables.com": "Printables",
      "github.com": "GitHub",
      "gitlab.com": "GitLab",
      "npmjs.com": "npm",
      "tiktok.com": "TikTok",
      "steampowered.com": "Steam",
      "trello.com": "Trello",
      "openstreetmap.org": "OpenStreetMap",
      "osm.org": "OpenStreetMap",
      "spotify.com": "Spotify",
      "x.com": "X",
      "twitter.com": "X",
      "arxiv.org": "arXiv",
      "stackoverflow.com": "Stack Overflow",
      "serverfault.com": "Server Fault",
      "superuser.com": "Super User",
      "askubuntu.com": "Ask Ubuntu",
      "mathoverflow.net": "MathOverflow",
      "stackexchange.com": "Stack Exchange",
      "linkedin.com": "LinkedIn",
      "news.ycombinator.com": "Hacker News",
      "bsky.app": "Bluesky",
      // Generic path, but bbc.com omits og:site_name on its news articles - while the same
      // article on bbc.co.uk declares "BBC News", and bbc.com's own sport articles declare
      // "BBC Sport". Those keep their specific names; this only fills the gap, so it is the
      // one form that is right for every section.
      "bbc.com": "BBC",
      "bbc.co.uk": "BBC",
      // Also the generic path, and Substack declares no og:site_name at all - the publication's
      // name lives only in the <title>, after the author. This reaches roughly half of Substack
      // links: the rest are on the publication's own domain (thefp.com, noahpinion.blog), which
      // nothing here can recognise as Substack. Half is what is available, and the half it
      // misses loses only the label on a markdown link.
      "substack.com": "Substack",
      // Generic path too - real pages already declare this themselves, but the fallback
      // card built from a dead track's URL doesn't read the page at all, so this is what
      // its markdown-link label falls back to.
      "soundcloud.com": "SoundCloud",
      // Notion does declare a name, but it declares the workspace's: a page on the "notion"
      // workspace says og:site_name "notion on Notion". fetchNotion drops that, so this is
      // what every Notion card ends up labelled with.
      "notion.so": "Notion",
      "notion.site": "Notion",
      // Both invite hosts, and a floor for the generic path as well: discord.com's own
      // marketing pages (/download, /blog) declare no og:site_name at all.
      "discord.com": "Discord",
      "discord.gg": "Discord",
      "discordapp.com": "Discord",
   };

   /**
    * Whether fetching would yield a better inline label than a card's own stored fields.
    *
    * True only for the handlers that set `linkTitle`: a Twitch card holds the stream title
    * while its link wants the channel name, and Spotify writes its own localized phrasing.
    * Neither is persisted in the block, so those two are the only cards worth re-fetching
    * when turning one back into a link - everywhere else the stored title and host rebuild
    * the very same string, instantly and for free.
    *
    * Keep this in step with the handlers below: another one starting to set `linkTitle`
    * without being listed here would quietly lose that label on conversion.
    */
   static buildsRicherInlineLabel(url: string): boolean {
      return CheckIf.isTwitchUrl(url) || CheckIf.isSpotifyUrl(url) || CheckIf.isApplePodcastsUrl(url);
   }

   /**
    * Pure lookup, no request involved — safe to reuse anywhere a card's stored `host`
    * needs turning back into a display name (e.g. converting a card back to a plain link).
    */
   static siteNameFor(host: string): string | undefined {
      const clean = host.toLowerCase().replace(/^www[.]/, "");
      // Any language edition: it.wikipedia.org, en.m.wikipedia.org, ...
      if (clean === "wikipedia.org" || clean.endsWith(".wikipedia.org")) return "Wikipedia";

      // Walk up the subdomains so open.spotify.com and clips.twitch.tv match too
      const parts = clean.split(".");
      for (let i = 0; i < parts.length - 1; i++) {
         const name = LinkMetadataFetcher.SITE_NAMES[parts.slice(i).join(".")];
         if (name) return name;
      }
      return undefined;
   }

   /**
    * Fills in the site name for the dedicated fetchers, which can't read og:site_name.
    * A name parsed from the page always wins; when neither source knows it, the field
    * stays empty and callers simply don't show one.
    */
   private withSiteName(metadata: LinkMetadata, url: string): LinkMetadata {
      if (metadata.siteName) return metadata;

      let host = metadata.host;
      if (!host) {
         try { host = new URL(url).hostname; } catch { return metadata; }
      }

      const siteName = LinkMetadataFetcher.siteNameFor(host);
      return siteName ? { ...metadata, siteName } : metadata;
   }

   private stripCloudflareChallenge(url: string): string {
      // A URL copied right after solving a Cloudflare challenge carries a one-time
      // __cf_chl_tk token tied to that browser session. Re-fetching it replays a stale
      // token and Cloudflare returns 403. Strip every __cf_chl* param so we request the
      // clean URL instead (which has a chance of passing the managed challenge).
      try {
         const u = new URL(url);
         for (const key of [...u.searchParams.keys()]) {
            if (key.startsWith("__cf_chl")) u.searchParams.delete(key);
         }
         return u.toString();
      } catch {
         return url;
      }
   }

   /* --- GENERIC --- */
   /**
    * Two hooks, and the difference between them is the whole point.
    *
    * `isUnusable` says *we could not read the page* - it parsed, but into the site's
    * anti-bot or login shell rather than content (Reddit's wall). The external fallback is
    * exactly right for that, and it is checked in here rather than by the caller because
    * this method already falls back on failure: a caller that inspected the result and then
    * called fetchFallback itself would run it - and burn Microlink's small daily quota -
    * twice for the same card.
    *
    * `goneCard` says the opposite: the page read fine, and what it says is that the thing is
    * **not there**. That is proof, so Microlink is not asked (see the invariant in
    * docs/domain-coverage.md), and the hook returns the card to write instead - it builds it
    * because only the caller knows how to get a decent title out of that site's URL. It
    * exists because a 404 is not the only way a site says "gone": goodreads.com answers a
    * missing book with **200** and its own not-found furniture in the og tags, which reads
    * as a confident, entirely wrong card.
    */
   private async fetchGeneric(
      url: string,
      checks?: {
         isUnusable?: (metadata: LinkMetadata) => boolean;
         goneCard?: (metadata: LinkMetadata) => LinkMetadata | undefined;
      }
   ): Promise<LinkMetadata | undefined> {
      const res = await this.request(url, {
         "Referer": "https://www.google.com/"
      });

      if (!res || res.status !== 200) {
         console.debug(`Fetch failed for ${url}. Status: ${res?.status}`);
         // 404/410 is the server stating the page is not there. Microlink would render the
         // same absence at the cost of one of its ~25 daily requests, so it is not asked.
         // The error page's own <title> is about the error, so the title comes from the URL -
         // but its og:image and og:description are kept: they are the site's own furniture,
         // and a card carrying the site's graphic reads better than a bare one (Roberto's
         // call, 2026-09-03).
         if (res && (res.status === 404 || res.status === 410)) {
            const html = await this.decodeHtmlContent(res.arrayBuffer, res.text);
            return this.errorPageCard(url, html);
         }
         return this.fetchFallback(url);
      }

      const decodedText = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      const parser = new LinkMetadataParser(url, decodedText);
      const metadata = await parser.parse();

      // Some sites (e.g. zhihu.com) serve non-browser requests an unrendered SPA shell whose
      // <title> is left as the raw URL slug/id instead of the real page title — every other
      // og:/twitter:/description tag is missing too. parser.parse() still "succeeds" since it
      // found *a* title, so without this check we'd silently show that placeholder as if it
      // were real content, and never give the external fallback (if enabled) a chance.
      if (metadata && this.looksLikePlaceholder(metadata, url)) {
         console.debug(`Fetch for ${url} returned only a URL-slug placeholder title.`);
         return this.fetchFallback(url);
      }

      // Before isUnusable: this one is the site *telling* us the thing is gone, which is a
      // fact about the link, not a failure to read it. No fallback, no Microlink.
      const gone = metadata && checks?.goneCard?.(metadata);
      if (gone) {
         console.debug(`Fetch for ${url} returned the site's own not-found page; building from the URL.`);
         return gone;
      }

      if (metadata && checks?.isUnusable?.(metadata)) {
         console.debug(`Fetch for ${url} returned a placeholder page rather than real content.`);
         return this.fetchFallback(url);
      }

      return metadata ?? this.fetchFallback(url);
   }

   private async errorPageCard(url: string, html: string): Promise<LinkMetadata> {
      const parsed = await new LinkMetadataParser(url, html).parse();
      return this.withPageFurniture(this.buildUrlCard(url), parsed);
   }

   /**
    * A card built from the URL still keeps whatever furniture the page itself supplied.
    *
    * Roberto's call (2026-09-03) for the description and the image: they are the site's own,
    * and a card carrying the site's graphic reads better than a bare one. The **favicon**
    * joined them on 2026-09-07, having been missed: buildUrlCard guesses `/favicon.ico`, so a
    * removed Medium article lost the real `miro.medium.com` icon the page had just handed us.
    * Same reasoning as the other two - the site told us, so it is not ours to throw away.
    */
   /**
    * The same thing when the page is still HTML rather than an already-parsed card: parse it
    * only for its furniture and keep our own title. Used wherever a fetcher has a page in
    * hand that it has decided not to believe - Notion's shell, LinkedIn's sign-in wall,
    * Discord's front page - which is exactly when the title is a lie and the artwork is not.
    */
   private async withParsedFurniture(card: LinkMetadata, url: string, html: string): Promise<LinkMetadata> {
      return this.withPageFurniture(card, await new LinkMetadataParser(url, html).parse());
   }

   private withPageFurniture(card: LinkMetadata, parsed?: LinkMetadata): LinkMetadata {
      if (!parsed) return card;
      return {
         ...card,
         description: parsed.description,
         image: parsed.image,
         favicon: parsed.favicon ?? card.favicon,
      };
   }

   /**
    * Whether a parse "succeeded" but returned the SPA shell rather than the page.
    *
    * The tell is a title that is just the URL's own last segment. On its own that is not
    * enough: a title legitimately equals its slug whenever the thing is *named* by it, and
    * pypi.org/project/requests/ - og:title "requests" - was condemned for it, sent to
    * Microlink, and had the identical answer rejected a second time, ending as a bare card
    * for a page that had described itself perfectly. So the second half of the shell's
    * signature is now required too, the half the comment above always claimed and the code
    * never checked: a real shell carries no description and no image either. A page that
    * supplied one of those told us something, whatever its title looks like.
    */
   private looksLikePlaceholder(metadata: LinkMetadata, url: string): boolean {
      if (metadata.description || metadata.image) return false;
      return this.looksLikeUrlSlugTitle(metadata.title, url);
   }

   private looksLikeUrlSlugTitle(title: string, url: string): boolean {
      try {
         const segments = new URL(url).pathname.split("/").filter(Boolean);
         const lastSegment = segments[segments.length - 1];
         if (!lastSegment) return false;
         return title.trim().toLowerCase() === decodeURIComponent(lastSegment).trim().toLowerCase();
      } catch {
         return false;
      }
   }

   private async fetchFallback(url: string): Promise<LinkMetadata> {
      // Direct fetch failed (or yielded no usable metadata). If the user opted in,
      // try the external microlink.io service, which renders the page with a headless
      // browser and can get past Cloudflare-style challenges that requestUrl cannot.
      //
      // Reddit is excluded: the service answers 400 for subreddit/profile URLs, and for
      // posts it faces the same login wall we do while the embed path above already covers
      // them. Spending one of its ~25 daily requests here only takes quota from sites where
      // it can actually help.
      if (this.settings?.useExternalFallback && !CheckIf.isRedditUrl(url)) {
         // Once Microlink has answered 429 the quota is gone for the day - it is per IP and
         // daily - so every further call returns the same 429 and the round trip is skipped.
         // The notice still fires: that this link is one the direct fetch cannot handle is
         // worth knowing even on a day when nothing can be done about it.
         if (LinkMetadataFetcher.microlinkExhausted) {
            new Notice(LinkMetadataFetcher.MICROLINK_LIMIT_NOTICE);
            return this.lastResortCard(url);
         }

         const result = await this.fetchViaMicrolink(url);
         // Microlink can hit the same anti-bot placeholder shell we do — its headless
         // browser isn't a guaranteed bypass — so the result needs the same sanity check
         // as the direct fetch above, not a blind accept just because the call succeeded.
         // No retry-with-force-refresh here: it doubles the cost against Microlink's tight
         // daily quota (as low as 25/day) for a bypass that isn't reliable anyway — a stale
         // cached placeholder and a freshly-blocked render look identical from here.
         if (result.metadata) {
            if (!this.looksLikePlaceholder(result.metadata, url)) return result.metadata;
            console.debug(`Microlink result for ${url} looked like a placeholder title:`, result.metadata.title);
         }
         if (result.rateLimited) {
            LinkMetadataFetcher.microlinkExhausted = true;
            new Notice(LinkMetadataFetcher.MICROLINK_LIMIT_NOTICE);
            return this.lastResortCard(url);
         }
      }
      new Notice(`Couldn't fetch metadata for ${new URL(url).hostname}`);
      return this.lastResortCard(url);
   }

   /**
    * fetchTitleOnly gives up with the bare hostname as the title; the URL's own slug says more
    * than that ("This question does not exist" beats "stackoverflow.com"). When the URL has no
    * slug either, buildUrlCard lands on the same hostname and nothing changes - which keeps the
    * markdown-link command's "is this just the hostname?" check working.
    */
   private async lastResortCard(url: string): Promise<LinkMetadata> {
      const titleOnly = await this.fetchTitleOnly(url);
      return titleOnly.title === new URL(url).hostname ? this.buildUrlCard(url) : titleOnly;
   }

   /** Set when Microlink answers 429; its quota is daily, so nothing changes before tomorrow. */
   private static microlinkExhausted = false;

   /** Shown both when Microlink reports the limit and when a later link is skipped for it. */
   private static readonly MICROLINK_LIMIT_NOTICE =
      "Daily limit for the external metadata service (microlink.io) reached. Showing a basic card.\nTry again tomorrow.";

   private async fetchViaMicrolink(url: string): Promise<{ metadata?: LinkMetadata; rateLimited?: boolean; }> {
      // https://microlink.io — free, no API key. Sends the URL to a third-party server,
      // so this only runs when the user has explicitly enabled the external fallback.
      // Free tier is a small daily quota (as low as 25 requests/day, confirmed in practice —
      // Microlink's published numbers vary by endpoint and have changed over time); over that
      // the API returns HTTP 429. We deliberately take whatever this single call returns
      // (cached or not) rather than spending a second request on `force=true` to bypass the
      // cache — that bypass isn't reliable against a site actively blocking Microlink anyway,
      // and doubling the request cost against such a tight daily quota isn't worth it for that.
      new Notice("Fetching metadata via external service (microlink.io)…");
      try {
         const api = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
         const res = await this.request(api, { "Accept": "application/json" }, 15000);
         if (res?.status === 429) return { rateLimited: true };
         if (!res || res.status !== 200) {
            console.debug(`Microlink request failed for ${url}. Status: ${res?.status}`);
            return {};
         }

         const json = JSON.parse(res.text) as MicrolinkResponse;
         const d = json.data;
         if (json.status !== "success" || !d?.title) {
            console.debug(`Microlink returned no usable data for ${url}:`, json);
            return {};
         }

         const hostname = new URL(url).hostname;
         return {
            metadata: {
               url,
               title: LinkMetadataParser.sanitizeText(d.title) ?? d.title,
               author: d.author ?? undefined,
               description: LinkMetadataParser.sanitizeText(d.description),
               host: hostname,
               favicon: d.logo?.url ?? `https://${hostname}/favicon.ico`,
               image: d.image?.url ?? undefined,
               indent: 0,
            },
         };
      } catch (e) {
         console.error(`Microlink request threw for ${url}:`, e);
         return {};
      }
   }

   private async fetchTitleOnly(url: string): Promise<LinkMetadata> {
      const hostname = new URL(url).hostname;

      const res = await this.request(url, {
         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      });

      // A 202 or a 3xx often still carries the real page in its body, so the status alone is
      // not a reason to ignore it. A 4xx/5xx body is a different thing: its <title> describes
      // the error ("404 Not Found", "Just a moment..."), never the link, and putting that in a
      // card states something false about the page.
      if (res?.text && (res.status ?? 200) < 400) {
         const match = res.text.match(/<title[^>]*>([^<]+)<\/title>/i);
         const title = match?.[1]?.trim()
            ?.replace(/&amp;/g, "&")
            ?.replace(/&lt;/g, "<")
            ?.replace(/&gt;/g, ">")
            ?.replace(/&quot;/g, '"')
            ?.replace(/&#039;/g, "'");

         if (title) {
            return {
               url,
               title: LinkMetadataParser.sanitizeText(title, 300) ?? title,
               host: hostname,
               favicon: `https://${hostname}/favicon.ico`,
               indent: 0,
            };
         }
      }

      // Nothing worked - a minimal card with just the hostname as title. Deliberately not
      // buildUrlCard: the markdown-link command treats a bare-hostname title as "found
      // nothing" and keeps the plain URL, and a slug title would defeat that check.
      return {
         url,
         title: hostname,
         host: hostname,
         favicon: `https://${hostname}/favicon.ico`,
         indent: 0,
      };
   }

   /* --- YOUTUBE --- */
   private buildYouTubeFallback(url: string): LinkMetadata {
      const base = { url, host: "youtube.com", favicon: "https://www.youtube.com/favicon.ico", indent: 0 };
      if (/youtube\.com\/playlist\?/.test(url)) return { ...base, title: "YouTube playlist" };
      if (/youtube\.com\/shorts\//.test(url)) return { ...base, title: "YouTube Short" };
      return { ...base, title: "YouTube video" };
   }

   private async fetchYouTube(url: string): Promise<LinkMetadata | undefined> {
      // Channels: oEmbed doesn't support them, scrape the page directly
      if (/youtube\.com\/(@|c\/|channel\/)/.test(url)) {
         const res = await this.request(url, { "Accept-Language": "en-US,en;q=0.9" });
         if (!res || res.status !== 200) return this.fetchGeneric(url);
         const metadata = await new LinkMetadataParser(url, res.text).parse();
         if (!metadata) return this.fetchGeneric(url);
         return { ...metadata, author: metadata.title ?? undefined, host: "youtube.com", favicon: "https://www.youtube.com/favicon.ico" };
      }

      // Videos and playlists: both supported by oEmbed
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await this.request(oembedUrl);
      // oEmbed answers 400 for a video that is deleted, private or region-blocked. The watch
      // page is no help there - it carries no og:* tags at all and titles itself " - YouTube"
      // - so there is nothing to fetch and the URL is all there is to build from.
      if (!res || res.status !== 200) return this.buildYouTubeFallback(url);

      const data = JSON.parse(res.text) as OEmbedResponse;
      const videoId = this.getYouTubeVideoId(url);

      const image = videoId
         ? await this.getBestYouTubeThumbnail(videoId)
         : data.thumbnail_url;

      const isPlaylist = /youtube\.com\/playlist\?/.test(url);
      const { description, duration: videoDuration } = await this.getYouTubePageData(url, data.author_name ?? "");

      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: data.author_name ?? undefined,
         description: LinkMetadataParser.sanitizeText(description),
         host: "youtube.com",
         favicon: "https://www.youtube.com/favicon.ico",
         image,
         duration: isPlaylist ? "Playlist" : videoDuration,
         indent: 0,
      };
   }

   private getYouTubeVideoId(url: string): string | undefined {
      return url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
   }

   private async getYouTubePageData(
      url: string,
      authorName: string
   ): Promise<{ description: string | undefined; duration?: string; }> {
      const fallback = { description: undefined as string | undefined };

      const res = await this.request(url, {
         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
         "Accept-Language": "en-US,en;q=0.9",
      });

      if (!res || res.status !== 200) return fallback;

      // Extract shortDescription (video-specific)
      let description = fallback.description;
      const descMatch = res.text.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (descMatch) {
         try {
            const raw = (JSON.parse(`"${descMatch[1]}"`) as string).trim();
            if (raw) description = raw.length > 160 ? raw.slice(0, 160) + "..." : raw;
         } catch { /* keep fallback */ }
      }

      // Fallback to og:description for non-video pages (e.g. playlists)
      if (!description) {
         const ogMatch = res.text.match(/property="og:description"\s+content="([^"]*)"/i)
            ?? res.text.match(/content="([^"]*)"\s+property="og:description"/i);
         if (ogMatch?.[1]) {
            const raw = ogMatch[1].trim();
            if (raw) description = raw.length > 160 ? raw.slice(0, 160) + "..." : raw;
         }
      }

      // Extract duration from lengthSeconds
      let duration: string | undefined;
      const lengthMatch = res.text.match(/"lengthSeconds":"(\d+)"/);
      if (lengthMatch) duration = this.formatDuration(parseInt(lengthMatch[1]!, 10));

      return { description, duration };
   }

   private async getBestYouTubeThumbnail(videoId: string): Promise<string> {
      // "max-resolution": fetch the highest available pixel size (better when saving to vault).
      // "better-preview" (default): fetch a size matched to the card slot (min(200px,40%) wide).
      //   sddefault WebP (640×480) → sddefault JPG → mqdefault WebP (320×180, clean 16:9) → mqdefault JPG.
      //   Avoids maxresdefault (1280×720) which causes pixelation from a 6× CSS downscale.
      const maxRes = this.settings?.thumbnailQuality === "max-resolution";

      const candidates = maxRes
         ? [
            `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
            `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
            `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
         ]
         : [
            `https://i.ytimg.com/vi_webp/${videoId}/sddefault.webp`,
            `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
            `https://i.ytimg.com/vi_webp/${videoId}/mqdefault.webp`,
            `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
         ];

      for (const url of candidates) {
         const res = await this.request(url);
         if (res && res.status === 200) return url;
      }

      // hqdefault.jpg is guaranteed for every video
      return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
   }

   /* --- VIMEO --- */
   private async fetchVimeo(url: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(
         `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      );
      if (!res || res.status !== 200) {
         // oEmbed 404s for two different things: a video that is gone, and a URL that never was
         // one (`vimeo.com/<user>`, which reads fine generically). Only the first is proven
         // dead - and its page answers **200** with no <title> and no og tags at all, so the
         // 404/410 rule in fetchGeneric never fires and a Microlink request gets spent on it.
         // A 6+ digit path segment is the video id form.
         if (res?.status === 404 && /\/\d{6,}(?:\/|$|[?#])/.test(url)) {
            console.debug(`Vimeo has no video at ${url}; building a card from the URL.`);
            return { url, title: "Vimeo video", host: "vimeo.com", favicon: "https://vimeo.com/favicon.ico", indent: 0 };
         }
         return this.fetchGeneric(url);
      }

      const data = JSON.parse(res.text) as OEmbedResponse;
      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: data.author_name ?? undefined,
         description: data.description
            ? LinkMetadataParser.sanitizeText(data.description)
            : undefined,
         host: "vimeo.com",
         favicon: "https://vimeo.com/favicon.ico",
         image: data.thumbnail_url,
         duration: this.formatDuration(data.duration),
         indent: 0,
      };
   }

   /* --- DAILYMOTION --- */
   private async fetchDailymotion(url: string): Promise<LinkMetadata | undefined> {
      // oEmbed does not include duration — use the public API instead
      const videoId = url.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/)?.[1];
      if (!videoId) return this.fetchGeneric(url);

      const res = await this.request(
         `https://api.dailymotion.com/video/${videoId}?fields=title,description,duration,thumbnail_720_url,owner.screenname`
      );
      // The id was taken from a /video/ (or dai.ly/) URL, so a 404 here is the video itself
      // being gone - proof, not a failed call. Its page then answers **200** with no og tags
      // and a bare "Dailymotion" <title>, indistinguishable from a live one to fetchGeneric,
      // which would spend a Microlink request and end up writing that same empty title.
      if (res?.status === 404) {
         console.debug(`Dailymotion has no video ${videoId}; building a card from the URL.`);
         return { url, title: "Dailymotion video", host: "dailymotion.com", favicon: "https://www.dailymotion.com/favicon.ico", indent: 0 };
      }
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      const data = JSON.parse(res.text) as DailymotionVideoResponse;
      const author = data["owner.screenname"];
      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: author ?? undefined,
         description: data.description
            ? LinkMetadataParser.sanitizeText(data.description)
            : undefined,
         host: "dailymotion.com",
         favicon: "https://www.dailymotion.com/favicon.ico",
         image: data.thumbnail_720_url,
         duration: this.formatDuration(data.duration),
         indent: 0,
      };
   }

   /* --- TWITCH --- */

   // Rotated user agents to reduce Cloudflare fingerprint collisions on retries
   private readonly twitchUserAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
   ];

   private isTwitchResponseUsable(html: string): boolean {
      // Detect the SPA shell: og:title is absent or is just "Twitch"
      const m = html.match(/property="og:title"\s+content="([^"]*)"/i)
         ?? html.match(/content="([^"]*)"\s+property="og:title"/i);
      if (!m || !m[1]) return false;
      return m[1].trim().length > 0 && !/^twitch\.?(tv)?$/i.test(m[1].trim());
   }

   /**
    * Twitch. Justified by field rule A1(a): Twitch serves real og tags server-side, but
    * answers roughly one request in four - live pages included - with the SPA shell, a bare
    * `<title>Twitch</title>` and nothing else (measured 2026-09-11). So the page is retried
    * with rotated user agents, and then read as it is, with only Twitch's templates undone
    * (rule B6). The request asks for English on purpose: the templates are then fixed and
    * proven, where other languages reword them ("Live su Twitch", "shroud - Twitch" for
    * "shroud on Twitch", a different dash in German). What that costs is Twitch's own stock
    * phrases in the descriptions; titles, bios and stream titles are the creator's text in
    * any language.
    *
    * - A VOD or a clip, "<title> - <channel> on Twitch": the channel moves to `author` and
    *   "on Twitch" goes. On a `/<channel>/clip/` URL the segment must match the URL's
    *   channel, and anything off the template is left whole.
    * - Every other page - a channel, offline ("shroud - Twitch") or live ("shroud - Live on
    *   Twitch"), or anything else ("All Categories - Twitch") - loses only that trailing
    *   site-name segment, "Live" being the instant state rule C4 keeps out of a card. A
    *   channel also carries its name as the author (rule F4).
    *
    * Descriptions, images and the favicon are the page's. Before 2026-09-11 every channel
    * page was treated as live: the title was replaced by the description (for an offline
    * channel, its bio), the description by a sentence of ours ("Watch shroud live on
    * Twitch"), and the duration set to "Live" even when it was not; a clip's description was
    * replaced by a sentence of ours too.
    */
   private async fetchTwitch(url: string): Promise<LinkMetadata | undefined> {
      const retryDelays = [0, 1500, 3000];
      let shell: string | undefined;

      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
         if (attempt > 0) await new Promise(r => window.setTimeout(r, retryDelays[attempt]));

         const ua = this.twitchUserAgents[attempt % this.twitchUserAgents.length]!;
         const res = await this.request(url, {
            "User-Agent": ua,
            "Referer": "https://www.google.com/",
            "Accept-Language": "en-US,en;q=0.9",
         }, 9000);

         if (!res || res.status !== 200) continue;
         if (!this.isTwitchResponseUsable(res.text)) {
            shell = res.text;
            continue;
         }

         const parser = new LinkMetadataParser(url, res.text);
         const metadata = await parser.parse();
         if (!metadata) continue;
         // Read off the parsed document, not with a regex: Twitch writes `content` before
         // `property` on some tags and after it on others (`<meta content="profile"
         // property="og:type"/>`), and a pattern for one order missed the channel entirely.
         const og = (property: string) =>
            parser.htmlDoc.querySelector(`meta[property='${property}']`)?.getAttribute("content") ?? undefined;

         const isClip = /\/clip\//.test(url) || url.includes("clips.twitch.tv");
         const isVod = /\/videos\//.test(url);

         if (isVod || isClip) {
            // A VOD or clip that does not exist is not the shell but a real page with a stock
            // title - "VOD - Twitch" (the same on four dead ids), "Clip - Twitch", "Clip of
            // shroud - Twitch" - which names no video at all (rule B3): the URL's label, and
            // the page's own blurb and logo along with it.
            if (/^(?:VOD|Clip)(?: of \S+)? - Twitch$/.test(metadata.title)) {
               return this.withPageFurniture(this.buildTwitchFallback(url), metadata);
            }
            const parsed = LinkMetadataFetcher.parseTwitchVideoTitle(metadata.title, this.extractTwitchChannel(url));
            const duration = this.extractTwitchDuration(res.text, og("og:video:duration"));
            if (!parsed) return { ...metadata, duration };
            return { ...metadata, ...parsed, duration, linkTitle: `${parsed.title} - ${parsed.author}` };
         }

         const title = metadata.title.replace(/\s+[-–]\s+(?:Live on )?Twitch$/i, "").trim() || metadata.title;
         // A channel - `og:type` "profile" offline, "video.other" live; every other page
         // declares "website" - carries its own name as the author too, the way a YouTube
         // channel card does (field rule F4).
         const ogType = og("og:type");
         const isChannel = ogType === "profile" || ogType === "video.other";
         return { ...metadata, title, author: isChannel ? title : undefined };
      }

      // The shell every time. A channel that does not exist answers with it on every request
      // (8 of 8, measured 2026-09-11), where a live one gets past it within three tries
      // nearly always - so this is almost certainly a missing channel, and in any case a
      // page read that is not about the link: the title comes from the URL rather than the
      // shell's "Twitch" (rule B3), and the shell's own blurb and logo ride along (rule C5).
      // No Microlink - it would render the same shell. Its tags are single-quoted
      // (`property='og:title'`), which is why isTwitchResponseUsable, looking for double
      // quotes, never mistakes it for a page.
      if (shell) return this.withParsedFurniture(this.buildTwitchFallback(url), url, shell);

      // No answer at all - a dead network, a 5xx. That proves nothing, so the normal path.
      return this.fetchGeneric(url);
   }

   /**
    * A Twitch URL names its channel, when it carries one at all, and otherwise only says
    * what kind of thing it points at. The channel is an identifier and stays verbatim.
    */
   private buildTwitchFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      const isClip = /\/clip\//.test(url) || url.includes("clips.twitch.tv");
      if (isClip) return { ...card, title: "Twitch clip" };
      if (/\/videos\//.test(url)) return { ...card, title: "Twitch video" };
      return { ...card, title: this.extractTwitchChannel(url) ?? card.title };
   }

   private extractTwitchChannel(url: string): string | undefined {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      // clips.twitch.tv/SlugName — slug is not a channel name
      if (parsed.hostname === "clips.twitch.tv") return undefined;
      // twitch.tv/videos/ID — no channel in path
      if (parts[0] === "videos") return undefined;
      // twitch.tv/channelname/clip/xyz → parts[0] is the channel name
      return parts[0] ?? undefined;
   }

   /**
    * "<title> - <channel> on Twitch", the template of a VOD and a clip. A channel name holds
    * no spaces, so the last " - " before it is unambiguous whatever the title itself
    * contains. When the URL names the channel, the segment has to be that channel (case
    * aside); anything else - another shape, a display name the URL does not match - leaves
    * the title whole (rule B6).
    */
   private static parseTwitchVideoTitle(raw: string, urlChannel?: string): { title: string; author: string; } | undefined {
      const m = raw.match(/^(.+) - (\S+) on Twitch$/);
      if (!m) return undefined;
      const title = m[1]!.trim();
      const author = m[2]!;
      if (urlChannel && author.toLowerCase() !== urlChannel.toLowerCase()) return undefined;
      return title ? { title, author } : undefined;
   }

   private extractTwitchDuration(html: string, ogDuration?: string): string | undefined {
      const secMatch = html.match(/"durationSeconds"\s*:\s*(\d+)/);
      if (secMatch) return this.formatDuration(parseInt(secMatch[1]!, 10));
      return ogDuration && /^\d+$/.test(ogDuration) ? this.formatDuration(parseInt(ogDuration, 10)) : undefined;
   }

   /* --- TED --- */
   private async fetchTed(url: string): Promise<LinkMetadata | undefined> {
      // Fetch the talk page — TED serves og: tags + JSON-LD VideoObject with ISO 8601 duration
      const res = await this.request(url);
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      const parser = new LinkMetadataParser(url, res.text);
      const metadata = await parser.parse();
      if (!metadata) return this.fetchGeneric(url);

      return {
         ...metadata,
         author: this.extractTedSpeaker(res.text),
         host: "ted.com",
         favicon: "https://www.ted.com/favicon.ico",
         duration: this.extractIso8601Duration(res.text),
      };
   }

   private extractTedSpeaker(html: string): string | undefined {
      // TED-specific field in their page data
      const presenterMatch = html.match(/"presenterDisplayName"\s*:\s*"([^"]+)"/);
      if (presenterMatch) return presenterMatch[1];

      // JSON-LD: extract the author block first, then find "name" within it
      // (avoids [^}]* failing when the object contains arrays or nested objects)
      const authorBlock = html.match(/"author"\s*:\s*\{([^{}]+)\}/);
      if (authorBlock?.[1]) {
         const nameMatch = authorBlock[1].match(/"name"\s*:\s*"([^"]+)"/);
         if (nameMatch) return nameMatch[1];
      }

      return undefined;
   }

   /* --- REDDIT --- */

   // Reddit blocks unauthenticated access to post data (both the ".json" endpoints and the
   // old.reddit.com HTML pages return 403 / a login wall since May 2026), and registering for
   // the official OAuth API now requires manual approval that is rarely granted. What is still
   // open is the embed machinery: Reddit wants third-party sites to embed posts, because an
   // embed drives traffic back to reddit.com — unlike raw data access, which competes with its
   // AI-training licensing deals. So we read what the embed exposes:
   //   - www.reddit.com/oembed  → real title and post author, as JSON (a public standard
   //                              endpoint, and the stable half of this)
   //   - embed.reddit.com/<path> → the widget's server-rendered page, scraped for the post's
   //                              image and body text (no contract; markup may change)
   // If the scrape half breaks, the card still has a title and subreddit from oEmbed.
   private async fetchReddit(url: string, refresh = false): Promise<LinkMetadata | undefined> {
      const isPost = LinkMetadataFetcher.REDDIT_POST_URL.test(url);
      const result = await this.fetchRedditCard(url, refresh, isPost);

      // A text or link post, a profile and a subreddit all have no image of their own, and
      // Reddit answers share.redd.it/preview/… with one static branded graphic (Snoo +
      // wordmark) - the same tile Notion shows.
      //
      // The endpoint ignores what it is asked for: /post/<id>, /user/<name>, a made-up id and
      // a nonexistent user all returned the identical 54014-byte file (sha1 a9f3283…) when
      // checked on 2026-09-02. Posts and profiles use the form Reddit declares as their own
      // og:image, so they follow along if it ever becomes a real per-item preview; subreddits,
      // for which Reddit declares only the 192px favicon, borrow the post form. Should that
      // ever start 404ing, the card simply drops the thumbnail.
      if (result && !result.image) {
         const key = url.match(/\/comments\/(\w+)/)?.[1]
            ?? (isPost ? undefined : url.match(/reddit\.com\/r\/([^/?#]+)/i)?.[1]);
         const user = url.match(/reddit\.com\/(?:u|user)\/([^/?#]+)/i)?.[1];
         if (key) result.image = `https://share.redd.it/preview/post/${encodeURIComponent(key)}`;
         else if (user) result.image = `https://share.redd.it/preview/user/${encodeURIComponent(user)}`;
      }
      return result;
   }

   private async fetchRedditCard(
      url: string, refresh: boolean, isPost: boolean
   ): Promise<LinkMetadata | undefined> {
      // Both endpoints only handle individual posts — oEmbed answers 400 for a subreddit or
      // profile URL — so don't spend a request finding that out.
      if (isPost) {
         const oembed = await this.fetchRedditOembed(url, refresh);
         if (oembed) return oembed;
      }

      // The Atom feed is the one public surface the lockdown left untouched, and it is meant
      // to be read by programs rather than merely tolerating it. For a subreddit it carries
      // the title and description the card used to show; for a post it is a last resort that
      // at least recovers the real title when the embed endpoints give nothing.
      const feed = await this.fetchRedditFeed(url, isPost, refresh);
      if (feed) return feed;

      // Nothing left to try. Fall back to the generic scrape, which handles the
      // external-service fallback itself.
      const metadata = await this.fetchGeneric(url, {
         isUnusable: m => this.isGenericRedditPage(m.title, m.description),
      });

      // That chain ends in fetchTitleOnly, which reads the page <title> without any such
      // guard — so a blocked subreddit/profile still comes back titled just "Reddit". The
      // name in the URL is both accurate and more useful than that, so prefer it.
      if (metadata && this.isGenericRedditPage(metadata.title)) {
         const name = this.redditNameFromUrl(url);
         if (name) return { ...metadata, title: name, host: "reddit.com" };
      }

      return metadata;
   }

   /**
    * Reads a subreddit's or post's Atom feed, the only endpoint Reddit still answers for a
    * page it otherwise hides behind a login wall.
    *
    * The feed's own <title> and <subtitle> sit before the first <entry>, so the text is cut
    * there rather than parsed as XML: an entry carries its own <title>, and picking the
    * wrong one would label a subreddit with whatever was posted to it most recently.
    */
   private async fetchRedditFeed(
      url: string, isPost: boolean, refresh: boolean, notifyIfThrottled = false
   ): Promise<LinkMetadata | undefined> {
      const name = this.redditNameFromUrl(url);
      // A profile's feed answers fine, it just carries nothing worth a request: no subtitle,
      // an icon that is Reddit's own logo rather than the avatar, and a title reading
      // "overview for someone" - poorer than the u/name the URL already gives for free.
      if (!name?.startsWith("r/")) return undefined;

      const cached = LinkMetadataFetcher.redditFeedCache.get(url);
      if (cached && !refresh) return cached;

      // Reddit allows one feed request per clock minute per IP, shared across every call site
      // (subreddit cards and this post supplement alike). Spending the wait to collect a 429
      // helps nobody, so skip once the minute is used up — checked against the raw budget, not
      // redditFeedDelay(url), which deliberately reports 0 for posts (see its own doc comment).
      const wait = LinkMetadataFetcher.feedBudgetSecondsLeft();
      if (wait > 0) {
         // Only the post-description supplement asks for this: a subreddit card already warns
         // before touching the note (reportRefreshDelay in main.ts), so noticing again here
         // would double up. A post's card is complete without this field, so unlike that
         // pre-check, this fires *after* the fact and never blocks anything.
         if (notifyIfThrottled) {
            new Notice(`Reddit allows one request a minute.\nTry again in ${wait}s to try to retrieve a description.`);
         }
         return undefined;
      }

      const feedUrl = `${url.replace(/[?#].*$|\/+$/, "")}/.rss`;
      // Like the embed page (see fetchRedditEmbedContent), .rss honours Accept-Language and
      // machine-translates the post - oEmbed is the one exception, confirmed never to. There is
      // no header value that reliably matches oEmbed's untranslated title: pinning English
      // fixes an English post but mistranslates a non-English one, and omitting the header
      // doesn't mean "original text" either - Reddit then falls back to guessing from the
      // requester's IP geolocation, which mismatches just as often (confirmed: a European IP
      // got an English post's title untouched from oEmbed but its description translated to
      // the requester's own language here). No header is the pragmatic choice anyway: a
      // Swiss user reading Swiss-German subreddits wants this in German by default, same as
      // everywhere else in this fetcher (Amazon, YouTube, ...) - occasional title/description
      // language mismatch is the accepted cost, not something to chase further. For a
      // subreddit, title and description both come from here together regardless, so they're
      // always in the same language as each other no matter what.
      const res = await this.request(feedUrl, {
         "Accept": "application/atom+xml, application/xml",
         ...(isPost ? { "Accept-Language": undefined } : {}),
      });
      this.rememberRedditFeedBudget(res?.headers);

      // 429 included: being throttled is not worth a notice, the chain below still has a name
      if (!res || res.status !== 200 || !res.text) return undefined;

      const head = res.text.split("<entry")[0] ?? "";
      const title = this.decodeXmlText(head.match(/<title[^>]*>([^<]+)<\/title>/)?.[1]);
      const subtitle = this.decodeXmlText(head.match(/<subtitle[^>]*>([^<]+)<\/subtitle>/)?.[1]);
      if (!title) return undefined;

      // A post's feed title is suffixed with the subreddit, which the author field already
      // carries - strip it. A subreddit's reads the other way round: the handle leads, being
      // the canonical name, and the feed's own <title> follows. That second half is kept even
      // when it only respells the handle ("r/OfficeChairs - Office Chairs"), deliberately -
      // deduplicating it was tried and judged not worth the special case.
      const sub = name.slice(2);
      let cleanTitle: string;
      if (isPost) {
         cleanTitle = title.replace(new RegExp(`\\s*:\\s*${sub}$`, "i"), "").trim();
      } else {
         // Mods write a subreddit's <title> freely, and plenty of them open it with the handle
         // over again ("/r/buildapc - Planning on building a computer..."), which would leave
         // the card saying it twice. Only *this* sub's handle is stripped, and `\b` keeps
         // r/foo from eating the start of "/r/foobar - ..." - a title naming a different sub
         // keeps it. `sub` comes from a `(\w+)` URL capture, so it needs no regex escaping.
         const feedTitle = title
            .replace(new RegExp(`^/?r/${sub}\\b\\s*[-–—:|•·]*\\s*`, "i"), "")
            .trim();
         cleanTitle = feedTitle ? `${name} - ${feedTitle}` : name;
      }

      const metadata: LinkMetadata = {
         url,
         title: LinkMetadataParser.sanitizeText(cleanTitle, 300) ?? cleanTitle,
         // A post's <subtitle> is the subreddit's own description, not the post's - using it
         // here would describe the wrong thing. The post's actual self-text instead sits
         // inside its entry's <content>, extracted separately below.
         description: isPost ? this.extractRedditFeedEntryBody(res.text) : LinkMetadataParser.sanitizeText(subtitle),
         host: "reddit.com",
         favicon: "https://www.reddit.com/favicon.ico",
         indent: 0,
      };

      // Only successes are cached: remembering a throttled attempt would keep a link
      // degraded for the rest of the session over a limit that clears within the minute.
      LinkMetadataFetcher.redditFeedCache.set(url, metadata);
      return metadata;
   }

   /**
    * Seconds until this URL's metadata can be fetched again, or 0 when it can be now.
    *
    * Subreddits only: a post reads from oEmbed and the embed page, whose budgets (unlimited
    * and 200 per three minutes) are nowhere near tight enough to matter.
    *
    * A refresh consults this before touching the note. Left to run, the chain would reach
    * fetchTitleOnly and come back with a perfectly valid card holding nothing but the name
    * from the URL - a success as far as the caller can tell, which would overwrite a fuller
    * card with less. Nothing is lost by waiting instead, since the limit clears within the
    * minute.
    */
   static redditFeedDelay(url: string): number {
      // A subreddit page and nothing else. A post reads from oEmbed and the embed page first
      // and only *optionally* tops up its description from the feed - refusing its refresh, or
      // a profile's (which never reaches the feed at all), over a limit that at most costs a
      // bonus field would be a net loss. feedBudgetSecondsLeft() below is the raw budget this
      // deliberately excludes them from.
      const servedByFeed = LinkMetadataFetcher.REDDIT_SUBREDDIT_URL.test(url)
         && !LinkMetadataFetcher.REDDIT_POST_URL.test(url);
      if (!servedByFeed) return 0;

      return LinkMetadataFetcher.feedBudgetSecondsLeft();
   }

   /** Seconds left on the shared per-minute feed budget, regardless of URL type. */
   private static feedBudgetSecondsLeft(): number {
      return Math.max(0, Math.ceil((LinkMetadataFetcher.redditFeedBlockedUntil - Date.now()) / 1000));
   }

   /**
    * Reddit reports its feed budget on every response: `x-ratelimit-remaining` hits 0 after a
    * single request, and `x-ratelimit-reset` counts the seconds to the next clock minute.
    * Recording it lets the next call skip a request it already knows will be refused.
    */
   private rememberRedditFeedBudget(headers: Record<string, string> | undefined): void {
      if (!headers) return;

      const remaining = Number(headers["x-ratelimit-remaining"]);
      const reset = Number(headers["x-ratelimit-reset"]);
      if (!Number.isFinite(remaining) || remaining > 0) return;
      if (!Number.isFinite(reset) || reset <= 0) return;

      LinkMetadataFetcher.redditFeedBlockedUntil = Date.now() + reset * 1000;
   }

   /**
    * Pulls a text post's self-text out of the Atom feed's first `<entry>`, the only place it
    * appears (subreddit-level `<subtitle>` describes the subreddit, not the post). Reddit
    * escapes the entry's `<content>` as XML *around* HTML it renders unchanged from its own
    * old widget markup - a table with the thumbnail/link, the self-text in a `<div class="md">`,
    * and a "submitted by ..." footer. One decodeXmlText() unwraps the XML layer into that real
    * HTML string; DOMParser then decodes any HTML entities left inside it (e.g. `&#39;`) via
    * textContent, same as extractRedditEmbedBody does for the embed page.
    */
   private extractRedditFeedEntryBody(feedText: string): string | undefined {
      try {
         const entryBlock = feedText.split("<entry")[1]?.split("</entry>")[0];
         const contentXml = entryBlock?.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1];
         const html = this.decodeXmlText(contentXml);
         if (!html) return undefined;

         const doc = new DOMParser().parseFromString(html, "text/html");
         const text = doc.querySelector(".md")?.textContent?.replace(/\s+/g, " ").trim();
         return text ? LinkMetadataParser.sanitizeText(text) : undefined;
      } catch {
         return undefined;
      }
   }

   private decodeXmlText(value: string | undefined): string | undefined {
      return value
         ?.replace(/&lt;/g, "<")
         ?.replace(/&gt;/g, ">")
         ?.replace(/&quot;/g, '"')
         ?.replace(/&#39;|&apos;/g, "'")
         ?.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
         ?.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
         // Last, so a literal "&amp;#39;" doesn't turn into an apostrophe.
         ?.replace(/&amp;/g, "&")
         ?.trim();
   }

   private redditNameFromUrl(url: string): string | undefined {
      const subreddit = url.match(/reddit\.com\/r\/(\w+)/i)?.[1];
      if (subreddit) return `r/${subreddit}`;

      const user = url.match(/reddit\.com\/(?:u|user)\/([\w-]+)/i)?.[1];
      if (user) return `u/${user}`;

      return undefined;
   }

   private async fetchRedditOembed(originalUrl: string, refresh = false): Promise<LinkMetadata | undefined> {
      try {
         const api = `https://www.reddit.com/oembed?url=${encodeURIComponent(originalUrl)}`;
         const res = await this.request(api);
         if (res?.status !== 200) return undefined;

         const json = JSON.parse(res.text) as { title?: string; author_name?: string; };
         // Same login-wall/placeholder guard as everywhere else: never let Reddit's generic
         // "Reddit - ..." shell title through as if it were real post content.
         if (!json.title || this.isGenericRedditPage(json.title)) return undefined;

         // The subreddit is always in the URL — more reliable than parsing it back out of
         // the embed's author_name (which is the post author, not the subreddit).
         const subreddit = originalUrl.match(/reddit\.com\/r\/(\w+)/i)?.[1];
         // oEmbed itself carries neither image nor body text, but the embed widget it
         // describes is a server-rendered page that has both — fetch that for the rest.
         const embed = await this.fetchRedditEmbedContent(originalUrl);
         // The embed page only fills description for self posts (its rtjson element doesn't
         // exist for image/link posts). The Atom feed's first entry carries the same self-text
         // for those too, so try it as a bonus — but it shares the subreddit's one-per-minute
         // budget, so only when the embed page came up empty, and it never blocks the card
         // itself: title/author/image go through regardless, this only skips the extra field
         // when the minute is already spent (with a Notice, so there's something to retry for).
         // A refresh that lands in that minute keeps the description already on the card rather
         // than dropping it - see keepSupplements().
         const description = embed?.description ?? (await this.fetchRedditFeed(originalUrl, true, refresh, true))?.description;
         return {
            url: originalUrl,
            title: LinkMetadataParser.sanitizeText(json.title) ?? json.title,
            author: subreddit
               ? `r/${subreddit}`
               : json.author_name ? `u/${json.author_name}` : undefined,
            description,
            host: "reddit.com",
            favicon: "https://www.reddit.com/favicon.ico",
            image: embed?.image,
            indent: 0,
         };
      } catch (e) {
         console.debug(`Reddit oEmbed request failed for ${originalUrl}:`, e);
         return undefined;
      }
   }

   // embed.reddit.com serves the same post the official embed widget renders, as plain
   // server-side HTML with the real image and post body in it. It has to work for logged-out
   // visitors on third-party sites, so unlike the rest of Reddit it isn't behind the login
   // wall. Returns undefined (never throws) — the caller still has a usable title/author.
   private async fetchRedditEmbedContent(originalUrl: string): Promise<{ image?: string; description?: string; } | undefined> {
      try {
         // Only single posts. A subreddit URL renders a *listing* of many posts here, so
         // scraping "the" image/body out of it would silently attribute some arbitrary
         // post's content to the subreddit itself.
         if (!/reddit\.com\/r\/\w+\/comments\//i.test(originalUrl)) return undefined;

         const embedUrl = originalUrl
            .replace(/^https:\/\/(?:www\.|old\.)?reddit\.com/, "https://embed.reddit.com")
            .replace(/\?.*$/, "");
         if (!embedUrl.startsWith("https://embed.reddit.com")) return undefined;

         // Confirmed by fetching this same page with several headers: unlike oEmbed (which
         // supplies the title next to this description and never translates), embed.reddit.com
         // *does* machine-translate a self-post's body per Accept-Language. No header value
         // reliably matches oEmbed's language, English included - see the long comment in
         // fetchRedditFeed for why omitting it (Reddit's own IP-geolocation guess) is still
         // the pragmatic default rather than something to chase further.
         const res = await this.request(embedUrl, { "Accept-Language": undefined });
         if (res?.status !== 200) {
            console.debug(`Reddit embed page request failed for ${embedUrl}. Status: ${res?.status}`);
            return undefined;
         }

         // Prefer permanent i.redd.it uploads, then a signed preview.redd.it URL at a
         // sensible width. Link posts carry neither — their image lives on the linked site,
         // which the embed page doesn't reference at all.
         const iReddit = res.text.match(/https:\/\/i\.redd\.it\/[\w-]+\.\w+/)?.[0];
         return {
            image: iReddit ?? this.pickRedditPreview(res.text),
            description: this.extractRedditEmbedBody(res.text),
         };
      } catch (e) {
         console.debug(`Reddit embed page request failed for ${originalUrl}:`, e);
         return undefined;
      }
   }

   private extractRedditEmbedBody(html: string): string | undefined {
      // The embed page renders a text post's body into a div whose id is
      // "t3_<postid>-post-rtjson-content". Image/link posts simply have no such element.
      try {
         const doc = new DOMParser().parseFromString(html, "text/html");
         const body = doc.querySelector('[id$="-post-rtjson-content"]');
         const text = body?.textContent?.replace(/\s+/g, " ").trim();
         return text ? LinkMetadataParser.sanitizeText(text) : undefined;
      } catch {
         return undefined;
      }
   }

   // Reddit serves a login-wall shell for unauthenticated/bot requests instead of the real
   // post whenever it decides to rate-limit or block us. The exact wording has changed more
   // than once, so match the placeholder's shape (the whole title is just "Reddit", "Welcome
   // to Reddit", or "Reddit - ...") rather than a fixed string or a bare "reddit" substring —
   // real content is never titled that way, so this stays resilient to wording changes without
   // false-positiving on posts that merely mention Reddit. The description check is a second,
   // independent signal in case the title shape changes too.
   private isGenericRedditPage(title?: string, description?: string): boolean {
      return !title
         || /^(welcome to )?reddit(\s*-\s*.+)?$/i.test(title.trim())
         || /^log in or sign up to /i.test(description ?? "");
   }

   private pickRedditPreview(html: string): string | undefined {
      // Reddit embeds the same preview image at several widths (320, 640, 1080px, ...).
      // Collect every signed preview.redd.it URL with its width, then pick based on the
      // thumbnail quality setting:
      //   max-resolution  → the largest available width
      //   better-preview  → the smallest width that is still >= TARGET (sharp on the small
      //                     card but a fraction of the file size); largest if none reach it.
      // Filenames are slug-prefixed ("post-title-words-v0-<id>.png"), hence [\w-] not \w.
      const TARGET = 640;
      const matches = html.match(/https:\/\/preview\.redd\.it\/[\w-]+\.\w+\?[^"'\s<>]*/g);
      if (!matches?.length) return undefined;

      const candidates = matches
         .map(raw => raw.replace(/&amp;/g, "&"))
         .map(url => ({ url, width: parseInt(url.match(/[?&]width=(\d+)/)?.[1] ?? "0", 10) }))
         .sort((a, b) => a.width - b.width);

      if (this.settings?.thumbnailQuality !== "better-preview") {
         return candidates[candidates.length - 1]!.url; // max-resolution (also the default)
      }

      return (candidates.find(c => c.width >= TARGET) ?? candidates[candidates.length - 1]!).url;
   }

   /* --- X / TWITTER --- */

   // X serves a non-JS client almost nothing: most pages are a shell whose <title> is
   // "JavaScript is not available." A single tweet is the exception - the embed syndication
   // endpoint (cdn.syndication.twimg.com, what platform.twitter.com's widget.js calls, no
   // auth) returns it as clean JSON, quoted tweet included. Profiles, searches, hashtags and
   // lists carry real <meta> tags only when fetched with a crawler's user agent, the same
   // trick fetchPrintablesBotPage relies on. If both miss, a card is built from the URL.
   private async fetchX(url: string): Promise<LinkMetadata | undefined> {
      const normalized = url.replace(
         /^https?:\/\/(www\.|mobile\.|m\.)?(twitter|x)\.com/,
         "https://x.com"
      );

      // A list carries no metadata for anyone - a crawler UA still gets only X's generic
      // shell - so don't spend two requests discovering that.
      if (/\/i\/lists\//.test(normalized)) return this.buildXFallback(normalized);

      const tweetId = normalized.match(/\/status(?:es)?\/(\d+)/)?.[1];
      if (tweetId) {
         const fromApi = await this.fetchXTweet(normalized, tweetId);
         if (fromApi) return fromApi;
      }

      const fromPage = await this.fetchXPage(normalized);
      if (fromPage) return fromPage;

      return this.buildXFallback(normalized);
   }

   private async fetchXTweet(url: string, id: string): Promise<LinkMetadata | undefined> {
      // The token is derived from the id the way widget.js does it. The endpoint currently
      // accepts any value, but computing it keeps this working if that ever tightens.
      const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
      const lang = this.acceptLanguage().slice(0, 2) || "en";
      const api = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=${lang}`;

      const res = await this.request(api, { "Referer": "https://platform.twitter.com/" }, 9000);
      // A deleted, protected or suspended tweet answers with an HTML error page, not JSON.
      if (!res || res.status !== 200 || !res.text.trimStart().startsWith("{")) return undefined;

      let data: XSyndicationResponse;
      try {
         data = JSON.parse(res.text) as XSyndicationResponse;
      } catch {
         return undefined;
      }
      if (!data.text || !data.user?.screen_name) return undefined;

      const handle = `@${data.user.screen_name}`;
      const name = data.user.name?.trim() || handle;

      const [from, to] = data.display_text_range ?? [0, data.text.length];
      let body = (data.text.slice(from, to).trim() || data.text.trim())
         .replace(/\s*https?:\/\/t\.co\/\w+\s*$/, "")
         .trim();

      const q = data.quoted_tweet;
      if (q?.text && q.user?.screen_name) {
         const quoted = q.text.replace(/\s*https?:\/\/t\.co\/\w+\s*$/, "").trim();
         const clipped = quoted.length > 120 ? quoted.slice(0, 120).trimEnd() + "…" : quoted;
         body += `${body ? " " : ""}— quoting @${q.user.screen_name}: “${clipped}”`;
      }

      const image = data.photos?.find(p => p.url)?.url
         ?? data.mediaDetails?.find(m => m.media_url_https)?.media_url_https
         ?? this.pickXCardImage(data.card)
         ?? data.user.profile_image_url_https?.replace(/_normal\.(\w+)$/, "_400x400.$1");

      return {
         url,
         title: `${name} (${handle})`,
         description: LinkMetadataParser.sanitizeText(body),
         host: "x.com",
         siteName: "X",
         favicon: "https://x.com/favicon.ico",
         image,
         indent: 0,
      };
   }

   // A tweet that is just a link has no photos/mediaDetails - its image lives in the preview
   // `card` instead, one entry per size. Prefer a card-slot-sized rendition over the huge
   // original; the keys differ by card type (summary vs summary_large_image vs player).
   private pickXCardImage(card: XSyndicationResponse["card"]): string | undefined {
      const bv = card?.binding_values;
      if (!bv) return undefined;
      for (const key of [
         "summary_photo_image_large",
         "photo_image_full_size_large",
         "thumbnail_image_large",
         "player_image_large",
         "summary_photo_image",
         "thumbnail_image",
      ]) {
         const candidate = bv[key]?.image_value?.url;
         if (candidate) return candidate;
      }
      return undefined;
   }

   private async fetchXPage(url: string): Promise<LinkMetadata | undefined> {
      // A crawler UA gets the server-rendered <meta> tags instead of the JS shell.
      const res = await this.request(url, {
         "User-Agent": "Mozilla/5.0 (compatible; Twitterbot/1.0)",
      }, 9000);
      if (!res || res.status !== 200) return undefined;

      const decoded = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      const metadata = await new LinkMetadataParser(url, decoded).parse();

      const title = metadata?.title
         ?.replace(/\s*[/|]\s*X$/i, "")     // "… / X" from the <title> tag
         .replace(/\s+\S{1,3}\s+X$/i, "")   // localised "… on / su / em X" from og:title
         .replace(/\s+on X$/i, "")          // English, if the rule above didn't catch it
         .trim();
      // The shell a crawler UA didn't shake off. Its <title> is either the literal
      // "JavaScript is not available." or one of X's brand taglines, which start with the
      // bare brand and a separator ("X: l'app per tutto", "X. It's what's happening") - the
      // localised wording varies but that shape does not. A real page's title always leads
      // with the account or subject, and a profile/tweet always carries "(@handle)".
      const isBrandShell = /^(x|twitter)\b/i.test(title ?? "") && !title!.includes("(@");
      if (!metadata || !title || isBrandShell || /javascript is not available/i.test(title)) {
         return undefined;
      }

      // Some profiles put their bio in og:description, others only the bio's t.co link.
      let description = metadata.description?.trim();
      if (description && /^https?:\/\/t\.co\/\w+$/.test(description)) description = undefined;

      // X's placeholder OG image (abs.twimg.com/.../ssr/default/.../og/image.png) is a blank
      // logo card - drop it so the thumbnail slot stays empty rather than showing a non-image.
      const image = metadata.image && !/\/ssr\/default\/.*\/og\//.test(metadata.image)
         ? metadata.image
         : undefined;

      return {
         ...metadata,
         title,
         description: LinkMetadataParser.sanitizeText(description),
         image,
         host: "x.com",
         siteName: "X",
         favicon: "https://x.com/favicon.ico",
         indent: 0,
      };
   }

   private buildXFallback(url: string): LinkMetadata {
      const base = {
         url,
         host: "x.com",
         siteName: "X",
         favicon: "https://x.com/favicon.ico",
         indent: 0,
      };

      let parsed: URL;
      try {
         parsed = new URL(url);
      } catch {
         return { ...base, title: "X" };
      }
      const path = parsed.pathname;
      const query = parsed.searchParams.get("q");

      const hashtag = query?.match(/^#?(\w+)$/)?.[1] ?? path.match(/\/hashtag\/(\w+)/)?.[1];
      if (hashtag) return { ...base, title: `#${hashtag}` };
      if (path === "/search" && query) return { ...base, title: `Search: ${query}` };
      if (/^\/i\/lists\//.test(path)) return { ...base, title: "X list" };
      if (/^\/i\/communities\//.test(path)) return { ...base, title: "X community" };

      const poster = path.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/\d+/)?.[1];
      if (poster && poster.toLowerCase() !== "i") return { ...base, title: `Post by @${poster}` };

      const profile = path.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes))?\/?$/)?.[1];
      if (profile && !/^(home|explore|notifications|messages|i|search|settings|compose)$/i.test(profile)) {
         return { ...base, title: `@${profile}` };
      }

      return { ...base, title: "X" };
   }

   /* --- PRINTABLES --- */
   private async fetchPrintables(url: string): Promise<LinkMetadata | undefined> {
      // Printables uses Cloudflare bot protection that returns 403 for plain HTTP requests.
      // Try three approaches in order, so the user always gets at least a working card.

      const modelId = url.match(/printables\.com\/model\/(\d+)/)?.[1];
      if (!modelId) return this.fetchGeneric(url);

      // 1. GraphQL API — not behind the same Cloudflare wall as the web page
      const apiResult = await this.fetchPrintablesApi(modelId, url);
      if (apiResult) return apiResult;

      // 2. Page fetch with Googlebot UA — Cloudflare typically lets verified bots through
      const botResult = await this.fetchPrintablesBotPage(url);
      if (botResult) return botResult;

      // 3. URL-slug fallback — derive the title from the URL so the card is still useful
      return this.buildPrintablesFallback(url, modelId);
   }

   private async tryPrintablesGraphQL(body: Record<string, unknown>): Promise<string | undefined> {
      try {
         const res = await Promise.race([
            requestUrl({
               url: "https://api.printables.com/graphql/",
               method: "POST",
               headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json",
                  "Origin": "https://www.printables.com",
                  "Referer": "https://www.printables.com/",
                  "Accept-Language": "en-US,en;q=0.9",
               },
               body: JSON.stringify(body),
            }),
            new Promise<never>((_, reject) =>
               window.setTimeout(() => reject(new Error("Timeout")), 8000)
            ),
         ]);
         return res?.status === 200 ? res.text : undefined;
      } catch {
         return undefined;
      }
   }

   private async fetchPrintablesApi(modelId: string, url: string): Promise<LinkMetadata | undefined> {
      // Printables GraphQL: operation name "PrintProfile", variable $id of type ID!
      // Discovered from https://github.com/100prznt/PrintablesGraphQL
      const query = `query PrintProfile($id: ID!) {
        print(id: $id) {
          name
          summary
          description
          images { filePath }
          user { publicUsername }
        }
      }`;

      const raw = await this.tryPrintablesGraphQL({
         operationName: "PrintProfile",
         query,
         variables: { id: modelId },
      });

      if (!raw) return undefined;

      try {
         const data = JSON.parse(raw) as PrintablesGraphQLResponse;
         const print = data?.data?.print;
         if (!print?.name) return undefined;

         const firstImg = Array.isArray(print.images) ? print.images[0] : null;
         const imgPath: string | undefined = firstImg?.filePath ?? undefined;
         const image = imgPath
            ? (imgPath.startsWith("http") ? imgPath : `https://media.printables.com/${imgPath}`)
            : undefined;

         const rawDesc: string | undefined = print.summary || print.description || undefined;

         return {
            url,
            title: LinkMetadataParser.sanitizeText(print.name) ?? print.name,
            author: print.user?.publicUsername ?? undefined,
            description: rawDesc
               ? LinkMetadataParser.sanitizeText(rawDesc)
               : undefined,
            host: "printables.com",
            favicon: "https://www.printables.com/favicon.ico",
            image,
            indent: 0,
         };
      } catch {
         return undefined;
      }
   }

   private async fetchPrintablesBotPage(url: string): Promise<LinkMetadata | undefined> {
      // Cloudflare may pass Googlebot through for SEO content.
      // Use requestUrl directly (not this.request) so 403s are caught silently.
      try {
         const res = await Promise.race([
            requestUrl({
               url,
               headers: {
                  "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9",
                  "From": "googlebot(at)googlebot.com",
               },
            }),
            new Promise<never>((_, reject) =>
               window.setTimeout(() => reject(new Error("Timeout")), 8000)
            ),
         ]);

         if (!res || res.status !== 200) return undefined;

         const decodedText = await this.decodeHtmlContent(res.arrayBuffer, res.text);
         const parser = new LinkMetadataParser(url, decodedText);
         const metadata = await parser.parse();
         if (!metadata) return undefined;

         return {
            ...metadata,
            host: "printables.com",
            favicon: "https://www.printables.com/favicon.ico",
         };
      } catch {
         return undefined;
      }
   }

   private buildPrintablesFallback(url: string, modelId: string): LinkMetadata {
      // Derive a human-readable title from the URL slug
      // e.g. "voronoi-mushroom-lamp" → "Voronoi Mushroom Lamp"
      const slug = url.match(/printables\.com\/model\/\d+-(.+?)(?:[?#]|$)/)?.[1] ?? "";
      const title = slug
         ? slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
         : `Printables Model #${modelId}`;

      return {
         url,
         title,
         description: `3D model #${modelId} on Printables.com`,
         host: "printables.com",
         favicon: "https://www.printables.com/favicon.ico",
         indent: 0,
      };
   }

   /* --- IMDB --- */
   private async fetchImdb(url: string): Promise<LinkMetadata | undefined> {
      // Try tt/nm IDs first via suggestions API
      const idMatch = url.match(/imdb\.com\/(?:[a-z]{2}\/)?(?:title|name)\/(tt\w+|nm\w+)/);
      if (idMatch) return this.fetchImdbById(url, idMatch[1]!);

      // For all other IMDB URLs, build a card from the URL itself
      return this.buildImdbFallback(url);
   }

   private async fetchImdbById(url: string, id: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(`https://v2.sg.media-imdb.com/suggestion/x/${id}.json`);
      if (!res || res.status !== 200) return this.buildImdbFallback(url);

      const item = (JSON.parse(res.text) as ImdbSuggestionResponse)?.d?.[0];
      if (!item) return this.buildImdbFallback(url);

      return {
         url,
         title: item.l + (item.y ? ` (${item.y})` : ""),
         description: item.s ?? undefined,
         host: "imdb.com",
         favicon: "https://www.imdb.com/favicon.ico",
         image: item.i?.imageUrl ?? undefined,
         indent: 0,
      };
   }

   private buildImdbFallback(url: string): LinkMetadata {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(p => p && p.length > 2);

      // Remove locale prefix like "it", "fr", "de"
      const cleaned = parts.filter(p => !/^[a-z]{2}$/.test(p));

      const type = cleaned[0] ?? "";   // "video", "list", "search", "chart", "news" ...
      const id = cleaned[1] ?? "";   // "vi4264413977", "ls053181649", "top" ...

      const titleMap: Record<string, string> = {
         video: "IMDB Video",
         list: "IMDB List",
         search: "IMDB Search",
         chart: "IMDB Chart",
         news: "IMDB News",
      };

      const title = titleMap[type] ?? "IMDB";
      const description = id && !/^(top|bottom|popular)$/.test(id)
         ? `${type} · ${id}`
         : undefined;

      return {
         url,
         title,
         description,
         host: "imdb.com",
         favicon: "https://www.imdb.com/favicon.ico",
         indent: 0,
      };
   }

   /* --- GITHUB --- */

   // The API path is capped at 60 requests/hour/IP for unauthenticated callers, so a repo
   // built once is kept for the session - a refresh or a second paste of the same repo
   // reuses it rather than spending another request. Session-only, never written to disk.
   private static readonly gitHubCache = new Map<string, LinkMetadata>();

   private async fetchGitHub(url: string, refresh = false): Promise<LinkMetadata | undefined> {
      const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
      if (!m) return this.fetchGeneric(url);
      const [, owner, repo] = [m[0], m[1]!, m[2]!];
      const key = `${owner}/${repo}`.toLowerCase();

      const cached = LinkMetadataFetcher.gitHubCache.get(key);
      if (cached && !refresh) return { ...cached, url };

      const [apiRes, htmlRes] = await Promise.all([
         this.request(`https://api.github.com/repos/${owner}/${repo}`, {
            "Accept": "application/vnd.github+json",
         }),
         this.request(`https://github.com/${owner}/${repo}`, {
            "Referer": "https://www.google.com/",
         }),
      ]);

      // The social-preview image comes from the page whichever path fills the text.
      const fromPage = htmlRes?.text
         ? await new LinkMetadataParser(url, htmlRes.text).parse()
         : undefined;
      const image = fromPage?.image;

      // A 404 from the API is the repo being gone, renamed or private - and the page is a 404
      // too, so its <title> and star count describe nothing. `owner/repo` is the name a reader
      // knows it by; the 404 page's own image and description ride along, as everywhere else.
      // Not cached: the repo may exist tomorrow.
      if (apiRes?.status === 404 || htmlRes?.status === 404) {
         console.debug(`GitHub repo ${key} does not exist (API ${apiRes?.status}, page ${htmlRes?.status}).`);
         return {
            url,
            title: `${owner}/${repo}`,
            author: owner,
            description: fromPage?.description,
            host: "github.com",
            favicon: "https://github.com/favicon.ico",
            image,
            indent: 0,
         };
      }

      // Rate-limited (403) → rebuild from the repo's own HTML instead of the generic scrape,
      // which loses the star count and keeps GitHub's "Contribute to …" boilerplate.
      const card = apiRes?.status === 200
         ? this.gitHubCardFromApi(url, owner, repo, apiRes.text, image)
         : this.gitHubCardFromHtml(url, owner, repo, htmlRes?.text, image);

      if (!card) return this.fetchGeneric(url);

      LinkMetadataFetcher.gitHubCache.set(key, card);
      return card;
   }

   private compactCount(n: number): string {
      return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
   }

   private gitHubCardFromApi(
      url: string, owner: string, repo: string, body: string, image: string | undefined
   ): LinkMetadata | undefined {
      let data: GitHubRepoResponse;
      try {
         data = JSON.parse(body) as GitHubRepoResponse;
      } catch {
         return undefined;
      }

      const parts: string[] = [];
      if (data.description) parts.push(data.description);
      if (data.language) parts.push(data.language);
      parts.push(`★ ${this.compactCount(data.stargazers_count ?? 0)}`);

      return {
         url,
         title: data.full_name ?? `${owner}/${repo}`,
         author: owner,
         description: LinkMetadataParser.sanitizeText(parts.join(" · ")),
         host: "github.com",
         favicon: "https://github.com/favicon.ico",
         image,
         indent: 0,
      };
   }

   /**
    * Rebuilds the card from the repo's own HTML when the API is rate-limited. The star count
    * and the plain description both sit in the page - the description in an embedded JSON
    * blob, or recoverable from og:description by stripping GitHub's formulaic suffix. The
    * primary language is the one piece the page renders client-side, so a rate-limited card
    * loses just that middle segment ("… · TypeScript · …").
    */
   private gitHubCardFromHtml(
      url: string, owner: string, repo: string, html: string | undefined, image: string | undefined
   ): LinkMetadata | undefined {
      if (!html) return undefined;

      const description = this.extractGitHubHtmlDescription(html, owner, repo);
      const starsMatch = html.match(/"stargazerCount":(\d+)/);
      // Nothing usable in the page either - let the generic scrape (and its external
      // fallback) try instead of writing a card with just a title.
      if (!description && !starsMatch) return undefined;

      const parts: string[] = [];
      if (description) parts.push(description);
      if (starsMatch) parts.push(`★ ${this.compactCount(Number(starsMatch[1]))}`);

      return {
         url,
         title: `${owner}/${repo}`,
         author: owner,
         description: LinkMetadataParser.sanitizeText(parts.join(" · ")),
         host: "github.com",
         favicon: "https://github.com/favicon.ico",
         image,
         indent: 0,
      };
   }

   private extractGitHubHtmlDescription(html: string, owner: string, repo: string): string | undefined {
      // The repo's own JSON blob carries it verbatim (JSON-escaped).
      const raw = html.match(/"description":\s*"((?:[^"\\]|\\.)+?)"/)?.[1];
      if (raw) {
         try {
            const decoded = JSON.parse(`"${raw}"`) as string;
            if (decoded.trim()) return decoded.trim();
         } catch { /* fall through to og:description */ }
      }

      // og:description is the same text with one of GitHub's two fixed tails appended:
      //   "<desc>. Contribute to <owner>/<repo> development by creating an account on GitHub."
      //   "<desc> - <owner>/<repo>"
      const og = html.match(/<meta (?:property="og:description"|name="description") content="([^"]*)"/i)?.[1];
      if (!og) return undefined;
      const o = owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const r = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cleaned = og
         .replace(new RegExp(`\\.?\\s*Contribute to ${o}/${r} development by creating an account on GitHub\\.?\\s*$`, "i"), "")
         .replace(new RegExp(`\\s*-\\s*${o}/${r}\\s*$`, "i"), "")
         .trim();
      return cleaned || undefined;
   }

   /* --- GITLAB --- */

   // Same shape as GitHub: a repo built once is kept for the session so a refresh or a
   // second paste costs no request. Session-only, never written to disk.
   private static readonly gitLabCache = new Map<string, LinkMetadata>();

   /**
    * gitlab.com projects and groups, through the public REST API - no auth for a public one.
    *
    * The generic path already reads GitLab's og:* on a project page, but the title comes out
    * as "<Namespace> / <project> · GitLab" and there is no star count. `/api/v4/projects/<path>`
    * gives a clean `name_with_namespace` and the counts. The path can nest
    * (`group/subgroup/project`), so the whole thing is URL-encoded as one segment.
    *
    * A 404 there is a group page, a renamed/private/deleted project, or a typo. `fetchGeneric`
    * is the wrong fallback for the last two: GitLab redirects a missing project to
    * `/users/sign_in` (a 302, not a 404), so the generic path can't tell it is gone and spends
    * a Microlink request rendering the sign-in page. So the group API is tried next - a 200
    * there means it is a real group and gets its own card - and only when both miss is a card
    * built straight from the URL, with no further request.
    */
   private async fetchGitLab(url: string, refresh = false): Promise<LinkMetadata | undefined> {
      const path = url.match(/^https?:\/\/(?:www\.)?gitlab\.com\/([^?#]+)/i)?.[1]?.replace(/\/+$/, "");
      if (!path) return this.fetchGeneric(url);

      const key = path.toLowerCase();
      const cached = LinkMetadataFetcher.gitLabCache.get(key);
      if (cached && !refresh) return { ...cached, url };

      const encoded = encodeURIComponent(path);
      const res = await this.request(
         `https://gitlab.com/api/v4/projects/${encoded}`, { "Accept": "application/json" }
      );

      // A rate limit or a server error - the project may well exist, so let the generic
      // scrape (and its external fallback) try rather than declaring the link dead.
      if (res && res.status !== 200 && res.status !== 404) {
         console.debug(`GitLab projects API for ${path} returned ${res.status}; falling back to generic.`);
         return this.fetchGeneric(url);
      }

      if (res?.status === 200) {
         const card = this.gitLabProjectCard(url, path, res.text);
         if (!card) return this.fetchGeneric(url);
         LinkMetadataFetcher.gitLabCache.set(key, card);
         return card;
      }

      // Project 404. A real group gets its own card and is cached; anything else is built
      // from the URL and left uncached - it may be a project that exists again tomorrow.
      const group = await this.gitLabGroupCard(url, path, encoded);
      if (group) {
         LinkMetadataFetcher.gitLabCache.set(key, group);
         return group;
      }
      console.debug(`GitLab has no project or group at ${path}; building a card from the URL.`);
      return this.buildUrlCard(url);
   }

   private gitLabProjectCard(url: string, path: string, body: string): LinkMetadata | undefined {
      let data: GitLabProjectResponse;
      try {
         data = JSON.parse(body) as GitLabProjectResponse;
      } catch {
         return undefined;
      }

      const parts: string[] = [];
      if (data.description) parts.push(data.description);
      parts.push(`★ ${this.compactCount(data.star_count ?? 0)}`);

      return {
         url,
         title: data.name_with_namespace ?? data.name ?? path,
         author: data.namespace?.name ?? path.split("/")[0],
         description: LinkMetadataParser.sanitizeText(parts.join(" · ")),
         host: "gitlab.com",
         favicon: "https://gitlab.com/favicon.ico",
         // The project avatar - GitLab's own og:image is this same file. Often null, and the
         // card simply carries no image then, as GitHub's does when there is no social preview.
         image: data.avatar_url ?? undefined,
         indent: 0,
      };
   }

   private async gitLabGroupCard(url: string, path: string, encoded: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(
         `https://gitlab.com/api/v4/groups/${encoded}`, { "Accept": "application/json" }
      );
      if (!res || res.status !== 200) return undefined;

      let data: { name?: string; full_name?: string; description?: string; avatar_url?: string | null; };
      try {
         data = JSON.parse(res.text) as typeof data;
      } catch {
         return undefined;
      }

      return {
         url,
         title: data.full_name ?? data.name ?? path,
         description: LinkMetadataParser.sanitizeText(data.description ?? undefined),
         host: "gitlab.com",
         favicon: "https://gitlab.com/favicon.ico",
         image: data.avatar_url ?? undefined,
         indent: 0,
      };
   }

   /* --- MEDIUM --- */

   /**
    * Medium needs no fetcher either: the plugin reads its articles directly, real og tags and
    * all. (A scripted probe gets 403 from every user agent but Slackbot's, and a fetcher was
    * nearly written on that evidence - see the note on probe fidelity in the docs.)
    *
    * What it does need is the same guard as Goodreads. A removed article answers **200** with
    * `og:site_name` "Medium" and no `og:title`, `og:description` or `og:image` at all, so the
    * parser falls back to the page `<title>` - which is the bare word "Medium" on every Medium
    * page. The card came out titled "Medium" and otherwise empty: saying nothing while looking
    * like it had.
    */
   private fetchMedium(url: string): Promise<LinkMetadata | undefined> {
      return this.fetchGeneric(url, {
         goneCard: (metadata) => LinkMetadataFetcher.isBareSiteName(metadata, "Medium")
            ? this.withPageFurniture(this.buildMediumFallback(url), metadata)
            : undefined,
      });
   }

   /**
    * `/<publication>/<title-slug>-<hash>` - the hash is Medium's post id and means nothing to
    * a reader, so it goes before the slug becomes prose. A sentence, hence sentence case.
    */
   private buildMediumFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      const last = url.split(/[?#]/)[0]!.replace(/\/+$/, "").split("/").pop();
      // 8+ hex characters: Medium's ids are 12, and the floor keeps an ordinary English word
      // that happens to be all hex letters ("facade", "decade") from being amputated.
      const title = LinkMetadataFetcher.deslug(last?.replace(/-[0-9a-f]{8,}$/i, ""));
      return title ? { ...card, title } : card;
   }

   /**
    * Whether a page that parsed came back saying nothing but the site's own name - the shape
    * both Goodreads and Medium take when the thing is not there. No real article or book is
    * titled with just its host's name, and the caller has already narrowed this to one site.
    * The absent description is the second half of the signal: Goodreads' not-found page does
    * carry one (its marketing blurb), so that site passes its own extra check instead.
    */
   private static isBareSiteName(metadata: LinkMetadata, name: string): boolean {
      return metadata.title.trim().toLowerCase() === name.toLowerCase() && !metadata.description;
   }

   /* --- GOODREADS --- */

   /**
    * Goodreads gets no fetcher, and this is not one: a book that exists reads perfectly on
    * the generic path - real `og:title`, the blurb, the cover from `m.media-amazon.com` - and
    * none of that is touched.
    *
    * The one thing the generic path gets wrong is a book that does **not** exist. Goodreads
    * answers it with **HTTP 200**, `<title>Page not found</title>`, and og tags describing
    * the site rather than the page: `og:title` "Goodreads", the "Discover and share books you
    * love" blurb, and the Goodreads wordmark as the image. The 404 rule never fires, so the
    * card came out confident and completely wrong - the site's own furniture presented as if
    * it were the book. Hence `goneCard`: the tell is `og:title` being nothing but the site's
    * name, which no real book is titled, and the check is scoped to `/book/show/` anyway.
    */
   private fetchGoodreads(url: string): Promise<LinkMetadata | undefined> {
      return this.fetchGeneric(url, {
         goneCard: (metadata) => {
            if (metadata.title.trim().toLowerCase() !== "goodreads") return undefined;
            // The furniture rides along, as it does for a real 404 (see errorPageCard): only
            // the title has to stop claiming to be the book.
            return this.withPageFurniture(this.buildGoodreadsFallback(url), metadata);
         },
      });
   }

   private buildGoodreadsFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      // `/book/show/2767052-the-hunger-games` - the id leads, and on its own it tells a
      // reader nothing, so it is dropped before the slug is turned into prose. A URL with
      // only the id keeps buildUrlCard's answer, which is the bare host.
      const slug = url.match(/\/book\/show\/\d+[-.]([^/?#]+)/i)?.[1];
      const title = LinkMetadataFetcher.deslug(slug, "title");
      return title ? { ...card, title } : card;
   }

   /* --- APPLE PODCASTS --- */

   /**
    * Not a fetcher in the usual sense: a show or an episode already reads perfectly on the
    * generic path (real `og:title`, `og:description`, artwork), and a dead show id is a
    * real 404 - see the `titleFromUrlPath` fix above for the one thing that was wrong with
    * it. What the generic path leaves on the table is the show's own name on an **episode**
    * page: `og:title` is only ever the episode's own title ("Ep.176 ..."), and nothing in
    * `og:*` says which show it belongs to - except `og:description`, which Apple writes as
    * "Podcast Episode · \<show> · \<date> · \<duration>" (sometimes with an extra segment,
    * "Subscribers Only", between the date and the duration). The show name is reliably the
    * second segment regardless, so it becomes `author` - the Spotify/Twitch shape, an
    * inline label a card's own stored fields can't already rebuild, hence
    * `buildsRicherInlineLabel` re-fetching for it on conversion too. A show-level page's own
    * description never starts with "Podcast Episode", so this is a no-op there.
    */
   private async fetchApplePodcasts(url: string): Promise<LinkMetadata | undefined> {
      const metadata = await this.fetchGeneric(url);
      if (!metadata?.description) return metadata;
      const show = metadata.description.match(/^Podcast Episode\s*·\s*([^·]+)·/)?.[1]?.trim();
      return show ? { ...metadata, author: show, linkTitle: `${metadata.title} - ${show}` } : metadata;
   }

   /* --- OPENSTREETMAP --- */

   private static readonly osmCache = new Map<string, LinkMetadata>();

   // Tag keys that name what a place *is*, roughly best-first. `building` is last and only
   // counts when it's not the near-useless "yes". `boundary`, `landuse`, `highway` and the
   // like are deliberately absent - their values ("administrative", "residential") read as
   // jargon, not a description, so an object with only those gets a clean title and no
   // description rather than a bad one.
   private static readonly OSM_TYPE_KEYS = [
      "place", "tourism", "historic", "amenity", "leisure", "shop",
      "natural", "man_made", "aeroway", "office", "craft", "building",
   ];

   /**
    * A node, way or relation. Justified by field rule A1(d): the page's `og:description`
    * ("OpenStreetMap is a map of the world…") and `og:image` (the OSM logo) are the same for
    * every object, live or dead, so the generic card says nothing about the place beyond
    * its title - while the public API (the documented v0.6 read endpoint, no auth) has the
    * tags that do. Two reads, run together: the **page** for everything it gets right -
    * title, image, favicon, site name - and the **API** only for the description.
    *
    * The title is the page's own, already in the reader's language (OSM picks
    * `name:<lang>` itself from Accept-Language: "Percorso: Torre Eiffel (5013364)"). It is
    * a site template, "<type>: <name> (<id>)", so the one thing dropped is the " (<id>)"
    * (field rule B6), and only when the id in it is this object's. The type prefix stays,
    * and so do the directional-embedding characters OSM wraps the name in. An unnamed
    * object is titled "<type>: <id>" and is left as it is - the id is all it has.
    *
    * The description, in field rule C1's order: the object's own `description` tag
    * verbatim, else a composition of its type and city ("Attraction · Paris"), else the
    * page's generic blurb. A missing id is a **404**, a deleted one a **410**, both proof:
    * the title becomes a label by object type, and the page's furniture rides along.
    * Session cache per object.
    */
   private async fetchOpenStreetMap(url: string, refresh = false): Promise<LinkMetadata | undefined> {
      const m = url.match(/(?:openstreetmap\.org|osm\.org)\/(node|way|relation)\/(\d+)/i);
      if (!m) return this.fetchGeneric(url);
      const kind = m[1]!.toLowerCase();
      const id = m[2]!;
      const key = `${kind}/${id}`;

      const cached = LinkMetadataFetcher.osmCache.get(key);
      if (cached && !refresh) return { ...cached, url };

      const [page, api] = await Promise.all([
         this.fetchGeneric(url),
         this.request(`https://api.openstreetmap.org/api/0.6/${key}.json`, { "Accept": "application/json" }),
      ]);
      const furniture = page ?? { url, host: "openstreetmap.org", favicon: "https://www.openstreetmap.org/favicon.ico", indent: 0 };

      if (api && (api.status === 404 || api.status === 410)) {
         console.debug(`OpenStreetMap has no ${key}; keeping the page's furniture, labelling by type.`);
         return { ...furniture, url, title: `OpenStreetMap ${kind}` };
      }

      let tags: Record<string, string> = {};
      if (api?.status === 200) {
         try {
            tags = (JSON.parse(api.text) as OsmElementResponse).elements?.[0]?.tags ?? {};
         } catch { /* leave tags empty - the page's blurb stays as the description */ }
      }

      const typeKey = LinkMetadataFetcher.OSM_TYPE_KEYS.find(k => tags[k] && tags[k] !== "yes");
      const typeLabel = typeKey ? LinkMetadataFetcher.deslug(tags[typeKey]) : undefined;
      const place = tags["addr:city"] ?? tags["addr:place"] ?? tags["is_in:city"];
      const composed = [typeLabel, place].filter(Boolean).join(" · ") || undefined;
      const description = tags["description"] ?? composed;

      // The page's title when the page was really read - OSM's own notation, recognisable by
      // the id it carries. When it wasn't (a URL-built fallback, say), the API's plain `name`
      // is the next best thing (field rule B4), then a label by object type.
      const title = LinkMetadataFetcher.osmPageTitle(page?.title, id)
         || (tags["name"] && LinkMetadataParser.sanitizeText(tags["name"], 300))
         || `OpenStreetMap ${kind}`;

      const card: LinkMetadata = {
         ...furniture,
         url,
         title,
         description: description ? LinkMetadataParser.sanitizeText(description) : page?.description,
      };
      LinkMetadataFetcher.osmCache.set(key, card);
      return card;
   }

   /**
    * The page's own title with OSM's trailing " (<id>)" dropped, or undefined when the
    * title is not OSM's "<type>: …" notation carrying this object's id - i.e. the page was
    * not what answered. OSM wraps both the name and the id in directional-embedding
    * characters (U+202A ... U+202C: "Way: <LRE>Tour Eiffel<PDF> (<LRE>5013364<PDF>)"), so those are allowed
    * around the id; the ones around the name are left alone.
    */
   private static osmPageTitle(title: string | undefined, id: string): string | undefined {
      if (!title) return undefined;
      const bare = title.replace(/\p{Cf}/gu, "");
      if (!/^[^:]+:\s/.test(bare) || !new RegExp(`\\b${id}\\b`).test(bare)) return undefined;
      return title.replace(new RegExp(`\\s*\\(\\p{Cf}*${id}\\p{Cf}*\\)\\s*$`, "u"), "").trim() || undefined;
   }

   /* --- SOUNDCLOUD --- */

   /**
    * Not a fetcher: a real track, set or profile already reads perfectly on the generic
    * path - real `og:title`, `og:type` ("music.song"), description and the artwork, `og:
    * site_name` "SoundCloud". Confirmed 2026-09-10 with a live track and a live profile.
    *
    * What the generic path gets wrong is narrower than Goodreads' or Medium's version of
    * the same bug, and easy to miss because of it: a track/set URL that does **not** exist
    * answers **200** with SoundCloud's own homepage shell - `<title>SoundCloud - Hear the
    * world's sounds</title>`, a generic "Explore the largest community..." blurb, no `og:*`
    * tags at all (`robots: noindex, follow`) - while a **profile** URL for a made-up handle
    * still reads fine (SoundCloud's own 404 handling differs by route). The shell's fixed
    * opening words are the tell, the same shape as Goodreads' bare "Goodreads" title; unlike
    * that case there is a real description to keep, so it rides along as furniture rather
    * than the check depending on its absence.
    *
    * The URL is the only source for a name once the shell fires: `<user>/<slug>` becomes
    * the track title (deslugged, title case) and the user segment its author - the same
    * split GitHub's rate-limited fallback and HN's story-domain labelling make elsewhere.
    */
   private async fetchSoundCloud(url: string): Promise<LinkMetadata | undefined> {
      // A custom request+parse, like LinkedIn's, rather than a fetchGeneric goneCard: the
      // shell check alone would have covered the dead case, but the live one is worth more
      // than the generic path reads on its own - see the author note below - so both are
      // handled from the one page fetch here instead of two different code paths.
      const res = await this.request(url, { "Referer": "https://www.google.com/" });
      if (!res || res.status !== 200) {
         console.debug(`Fetch failed for ${url}. Status: ${res?.status}`);
         if (res && (res.status === 404 || res.status === 410)) {
            return this.errorPageCard(url, await this.decodeHtmlContent(res.arrayBuffer, res.text));
         }
         return this.fetchFallback(url);
      }

      const html = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      const metadata = await new LinkMetadataParser(url, html).parse();

      if (metadata?.title.trim().toLowerCase().startsWith("soundcloud - hear the world")) {
         console.debug(`SoundCloud has no resource at ${url}; building a card from the URL.`);
         return this.withPageFurniture(this.buildSoundCloudFallback(url), metadata);
      }
      if (!metadata) return this.buildSoundCloudFallback(url);

      // og:title is only ever the track's own name ("Deadmau5 Strobe") - unlike Spotify,
      // which reads the artist out of the page itself, nothing in og:* says who uploaded
      // it. SoundCloud declares it anyway, in a property of its own: `soundcloud:user`,
      // the uploader's profile URL, present on every track and set page. Kept verbatim,
      // the npm call: a username is an identifier, not prose, and deslugging one that's
      // mostly digits ("user2727940") produces "User2727940" - worse than the handle, not
      // better, since capitalising one letter of a string that is not a sentence reads as
      // a mistake rather than a name.
      const author = LinkMetadataFetcher.soundCloudAuthor(html);
      return author ? { ...metadata, author: metadata.author ?? author } : metadata;
   }

   private static soundCloudAuthor(html: string): string | undefined {
      return (html.match(/property="soundcloud:user"\s+content="https?:\/\/soundcloud\.com\/([^"/?#]+)/i)
         ?? html.match(/content="https?:\/\/soundcloud\.com\/([^"/?#]+)"\s+property="soundcloud:user"/i))?.[1];
   }

   private buildSoundCloudFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      const m = url.match(/soundcloud\.com\/([^/?#]+)\/([^/?#]+)/i);
      if (!m) return card;
      const title = LinkMetadataFetcher.deslug(m[2], "title");
      return title ? { ...card, title, author: m[1] } : card;
   }

   /* --- BANDCAMP --- */

   /**
    * Not a fetcher: a live album or track reads perfectly on the generic path (checked
    * 2026-09-10 against a real album and a real track - full og:title, tracklist or lyrics
    * in the description, cover art, even og:video for the embedded player), and a dead
    * track is a real 404. What showed up in Obsidian instead, on the very same live album
    * URL that read fine here, was Cloudflare's own interstitial - title "Client Challenge",
    * no og:* tags at all - accepted as if it were the page, since nothing before this
    * flagged it as anything other than a successful parse.
    *
    * This is Goodreads' 202 throttle and DataDome's scoring again, not a fixed block: which
    * request gets challenged depends on the requester (IP, session history), not the link,
    * so the *content* stays unpredictable regardless of anything this plugin does. What is
    * fixable is not trusting that page: `isUnusable` sends it to Microlink instead of
    * writing "Client Challenge" into a note as if it were the album's name.
    */
   private static readonly bandcampCache = new Map<string, LinkMetadata>();

   private async fetchBandcamp(url: string): Promise<LinkMetadata | undefined> {
      const cached = LinkMetadataFetcher.bandcampCache.get(url);
      if (cached) return cached;

      const result = await this.fetchGeneric(url, {
         isUnusable: (metadata) => metadata.title.trim().toLowerCase() === "client challenge",
      });
      if (!result) return result;

      // og:site_name here is the artist's own subdomain "site" ("Kishi Bashi"), not the
      // platform - Notion's "<workspace> on Notion" trick again - so it is discarded rather
      // than kept; a card that came back via Microlink after a Cloudflare challenge has no
      // siteName at all to discard, and needs the same floor for the same reason.
      const card = { ...result, siteName: "Bandcamp" };
      LinkMetadataFetcher.bandcampCache.set(url, card);
      return card;
   }

   /* --- NPM --- */

   private static readonly npmCache = new Map<string, LinkMetadata>();

   /**
    * npm packages, through the public registry - `registry.npmjs.org`, the documented and
    * versioned API every npm client already speaks. No auth, no key, no quota.
    *
    * Unlike GitLab, there is nothing to weigh here: **npmjs.com answers 403 to every user
    * agent** - a browser's, facebookexternalhit's and Googlebot's alike, checked 2026-09-04 -
    * so the generic path reads absolutely nothing and every npm link a vault holds would be
    * spent on Microlink. And since a missing package is a registry 404 while its page is the
    * same 403 a live one gives, only the registry can tell a dead link from a blocked one.
    *
    * `/<pkg>/latest` rather than `/<pkg>`: the full packument carries every version ever
    * published (6.7 MB for react), the latest manifest is 1 KB and holds everything a card
    * shows. Weekly downloads come from the separate downloads API - the one number that says
    * what a package is worth, npm's equivalent of GitHub's star count - and it is asked for
    * alongside, never blocking: no answer just means that segment is missing.
    *
    * No image. There is no per-package artwork, npm's own og:image is behind the 403, and the
    * npm wordmark would be site furniture the card already carries as its favicon - the same
    * call as the Stack Exchange question cards.
    */
   private async fetchNpm(url: string, refresh = false): Promise<LinkMetadata | undefined> {
      // `@scope/name` counts as one name; a trailing `/v/<version>` is not part of it.
      const pkg = url.match(/npmjs\.com\/package\/((?:@[^/?#]+\/)?[^/?#]+)/i)?.[1];
      if (!pkg) return this.fetchGeneric(url);

      // A `/v/<version>` link is about that version, so the card must not describe a
      // different one - the registry serves any published version at the same path.
      const version = url.match(/\/v\/([^/?#]+)/i)?.[1];
      const key = version ? `${pkg}@${version}` : pkg;

      const cached = LinkMetadataFetcher.npmCache.get(key);
      if (cached && !refresh) return { ...cached, url };

      const base = { url, host: "npmjs.com", favicon: "https://www.npmjs.com/favicon.ico", indent: 0 };
      // Only the slash is escaped: the registry wants `@scope%2Fname`, and rejects an
      // encoded `@`. The downloads API takes the plain form, slash and all.
      const [res, downloads] = await Promise.all([
         this.request(
            `https://registry.npmjs.org/${pkg.replace("/", "%2F")}/${encodeURIComponent(version ?? "latest")}`,
            { "Accept": "application/json" }
         ),
         this.request(`https://api.npmjs.org/downloads/point/last-week/${pkg}`, {
            "Accept": "application/json",
         }),
      ]);

      // 404 is the registry stating this is not published - the package at all, or the one
      // version a `/v/` link named. Proof either way, and the only source of it. The name is
      // already the most a reader can be told, so it is the title verbatim: a package name is
      // not a slug and must not be de-slugged into prose ("left-pad", never "Left pad").
      if (res?.status === 404) {
         console.debug(`npm has no ${key}; building a card from the URL.`);
         return { ...base, title: pkg };
      }
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      let data: NpmPackageResponse;
      try {
         data = JSON.parse(res.text) as NpmPackageResponse;
      } catch {
         return this.fetchGeneric(url);
      }

      const parts: string[] = [];
      if (data.description) parts.push(data.description);
      if (data.version) parts.push(`v${data.version}`);
      if (data.license) parts.push(data.license);
      const weekly = this.npmWeeklyDownloads(downloads?.status === 200 ? downloads.text : undefined);
      if (weekly !== undefined) parts.push(`${this.countLabel(weekly, "download")}/week`);

      const author = typeof data.author === "string" ? data.author : data.author?.name;
      const card: LinkMetadata = {
         ...base,
         title: data.name ?? pkg,
         // npm's `author` is free-form and often carries an email or a URL in the string
         // form; only the leading name is a name.
         author: author?.split(/\s*[<(]/)[0]?.trim() || undefined,
         description: LinkMetadataParser.sanitizeText(parts.join(" · ")),
      };
      LinkMetadataFetcher.npmCache.set(key, card);
      return card;
   }

   private npmWeeklyDownloads(body: string | undefined): number | undefined {
      if (!body) return undefined;
      try {
         const n = (JSON.parse(body) as { downloads?: number; }).downloads;
         return typeof n === "number" ? n : undefined;
      } catch {
         return undefined;
      }
   }

   /* --- TIKTOK --- */

   private static readonly tiktokCache = new Map<string, LinkMetadata>();

   /**
    * A profile or a video, through TikTok's own oEmbed endpoint - documented, unauthenticated,
    * the GitLab/npm/Steam category.
    *
    * Every unauthenticated TikTok page answers the identical wall: a profile or a video both
    * read generically as "Log in | TikTok" with a blurb about signing up, because the real
    * page is entirely client-rendered behind a mandatory login redirect. Confirmed in
    * Obsidian 2026-09-08. oEmbed is the one endpoint TikTok still serves for embedding, and
    * it answers a real profile with the display name and, for a video, the actual caption and
    * thumbnail - none of which the generic path can reach at all. A crawler UA (the LinkedIn/
    * Notion trick) does get a real page for a *profile*, with a richer description and an
    * avatar - but for a *video* it returns a generic placeholder ("TikTok · <name>", no real
    * caption), so it would need two different treatments for the two routes it has to cover.
    * oEmbed covers both from one source and is the documented one, so that fragility was not
    * worth taking on.
    *
    * A profile or video that does not exist (or cannot be embedded - suspended, private)
    * answers **400** with a generic `{"message":"Something went wrong"}` body. Not the 404 the
    * oEmbed spec calls for, but the only signal TikTok gives either way, and consistent for a
    * made-up handle and a made-up video id alike - proof, so the card is built from the URL's
    * own `@handle` and never from the login wall. A non-400/200 response or unparseable JSON
    * prove nothing and fall through to generic.
    *
    * No furniture rides along on that fallback, unlike Steam's dead-app storefront: a plain
    * request here lands on the login wall itself, which carries no image at all and a
    * description about signing in, not about the missing profile or video - keeping it would
    * read as wrong in a different way than a bare card does, not better.
    *
    * Session cache per handle (and video id), successes only.
    */
   private async fetchTikTok(url: string): Promise<LinkMetadata | undefined> {
      const m = url.match(/tiktok\.com\/@([^/?#]+)(?:\/video\/(\d+))?/i);
      const handle = m?.[1];
      if (!handle) return this.fetchGeneric(url);
      const videoId = m?.[2];
      const key = videoId ? `${handle}/${videoId}` : handle;

      const cached = LinkMetadataFetcher.tiktokCache.get(key);
      if (cached) return { ...cached, url };

      const clean = videoId
         ? `https://www.tiktok.com/@${handle}/video/${videoId}`
         : `https://www.tiktok.com/@${handle}`;
      const res = await this.request(
         `https://www.tiktok.com/oembed?url=${encodeURIComponent(clean)}`,
         { "Accept": "application/json" }
      );

      if (res?.status === 400) {
         console.debug(`TikTok has no oEmbed for ${clean}; building a card from the URL.`);
         return this.buildTikTokFallback(url, handle, videoId);
      }
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      let data: TikTokOEmbedResponse;
      try {
         data = JSON.parse(res.text) as TikTokOEmbedResponse;
      } catch {
         return this.fetchGeneric(url);
      }

      const base = { url, host: "tiktok.com", favicon: "https://www.tiktok.com/favicon.ico", indent: 0 };
      const card: LinkMetadata = videoId
         ? {
              ...base,
              title: LinkMetadataParser.sanitizeText(data.title, 300)
                 ?? data.title
                 ?? this.buildTikTokFallback(url, handle, videoId).title,
              author: data.author_name,
              image: data.thumbnail_url,
           }
         // oEmbed's own title is the fixed phrase "<name>'s Creator Profile" - not a good
         // card title. The shape every other profile card here uses ("<name> (@<handle>)",
         // X and Bluesky) needs no site suffix and reads better.
         : {
              ...base,
              title: data.author_name ? `${data.author_name} (@${data.author_unique_id ?? handle})` : `@${handle}`,
           };
      LinkMetadataFetcher.tiktokCache.set(key, card);
      return card;
   }

   /**
    * A handle is an identifier, not prose - kept verbatim, the same call npm makes for a
    * package name. A dead video gets the handle folded into a label, since the video's own
    * words (its caption) are exactly what oEmbed just refused to give.
    */
   private buildTikTokFallback(url: string, handle: string, videoId?: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      return { ...card, title: videoId ? `TikTok video by @${handle}` : `@${handle}` };
   }

   /* --- STEAM --- */

   private static readonly steamCache = new Map<string, LinkMetadata>();

   /**
    * Steam store app pages: the page, read together with the store's own unauthenticated
    * `appdetails` endpoint.
    *
    * A live app reads fine on the generic path - real `og:title` ("<name> su Steam", in the
    * reader's language), `og:description` and a share image - and so does a mature title:
    * the `/agecheck/` page a browser is redirected to declares the same complete og tags.
    * What the generic path cannot survive is a **missing** app id: Steam answers one with a
    * 302 to the storefront, itself a 200 declaring `og:title` "Steam Store" and `og:url`
    * `https://store.steampowered.com/`. Left generic, every dead Steam link becomes the
    * identical confident card advertising the store - field rule A1(b), and the reason this
    * fetcher exists. `appdetails?appids=<id>` answers `{"<id>":{"success":false}}` for an id
    * that is not a store app - the proof the page refuses to give. Only `success:false` on a
    * 200 is proof; a non-200, a network failure or unparseable JSON say nothing and fall
    * through to the generic path.
    *
    * Everything the page gives well comes from the page: its title (minus the
    * "<word> Steam" suffix, see steamTitle), description and image. The API adds only what
    * the page does not declare, the developer(s) as the author. Session cache per app id,
    * successes only.
    */
   private async fetchSteam(url: string, refresh = false): Promise<LinkMetadata | undefined> {
      const appid = url.match(/\/app\/(\d+)/i)?.[1];
      if (!appid) return this.fetchGeneric(url);

      const cached = LinkMetadataFetcher.steamCache.get(appid);
      if (cached && !refresh) return { ...cached, url };

      const base = {
         url,
         host: "store.steampowered.com",
         favicon: "https://store.steampowered.com/favicon.ico",
         indent: 0,
      };

      // The page is read alongside the API: its og:image is the share image Steam itself
      // chose (field rule D1 - the page's specific image wins), and on a dead id it is the
      // storefront whose furniture rides along, so that case needs no second request.
      const [res, page] = await Promise.all([
         this.request(
            `https://store.steampowered.com/api/appdetails?appids=${appid}`,
            { "Accept": "application/json" }
         ),
         this.request(url, { "Referer": "https://www.google.com/" }),
      ]);
      const html = page?.status === 200
         ? await this.decodeHtmlContent(page.arrayBuffer, page.text)
         : undefined;
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      let entry: SteamAppDetailsResponse[string];
      try {
         entry = (JSON.parse(res.text) as SteamAppDetailsResponse)[appid];
      } catch {
         return this.fetchGeneric(url);
      }

      // `success:false` on a 200 is Steam stating this id is not a store app - delisted,
      // region-locked out of existence, or never real. Proof, and the only source of it.
      if (!entry?.success || !entry.data) {
         console.debug(`Steam has no app ${appid}; building a card from the URL.`);
         const card = this.buildSteamFallback(url);
         // The `/app/<id>/` URL 302s to the storefront - a real page whose blurb and share
         // image are the site's own furniture on a page we have established says nothing
         // about the link. Keep them, replace only the title, exactly as the generic path
         // did before this fetcher existed. Never Microlink.
         return html ? this.withParsedFurniture(card, url, html) : card;
      }

      const d = entry.data;
      const name = LinkMetadataParser.sanitizeText(d.name, 300);
      // The page's description, not the API's (field rule C2): the page honours the
      // Accept-Language it is sent, while appdetails is cached at the CDN regardless of it and
      // answers in whichever language was last asked for - measured 2026-09-11, an Italian
      // request for Cyberpunk got English and an English one for Counter-Strike 2 got Italian.
      const parsed = html ? await new LinkMetadataParser(url, html).parse() : undefined;
      const card: LinkMetadata = {
         ...base,
         title: LinkMetadataFetcher.steamTitle(parsed?.title, name) || this.buildSteamFallback(url).title,
         author: d.developers?.filter(Boolean).join(", ") || undefined,
         description: parsed?.description || LinkMetadataParser.sanitizeText(d.short_description),
         image: parsed?.image || d.header_image || d.capsule_image || undefined,
      };
      LinkMetadataFetcher.steamCache.set(appid, card);
      return card;
   }

   /**
    * The page's title, with Steam's site template undone (field rule B6): an app page is
    * titled "<name> <word> Steam" - "su Steam", "on Steam", "auf Steam" by the reader's
    * language - and the site-name segment is dropped. The API's `name` is what proves the
    * template matched, so this needs no list of languages: only when the page title is
    * exactly that name followed by one word and "Steam" does it become the name. Anything
    * else (another word order, a name the two sources spell differently) keeps the page's
    * title untouched. Without a page title the API's name stands in (rule B4).
    */
   private static steamTitle(pageTitle: string | undefined, name: string | undefined): string | undefined {
      if (!pageTitle) return name;
      if (!name || !pageTitle.startsWith(name)) return pageTitle;
      return /^\s+\S+\s+Steam$/i.test(pageTitle.slice(name.length)) ? name : pageTitle;
   }

   /**
    * A Steam URL carries the app id and usually a name slug: `/app/570/Dota_2/`. Steam builds
    * that slug with underscores for spaces and keeps the title's own casing, so it needs no
    * deslugging - only the underscores turned back to spaces. A URL with just the id
    * (`/app/570/`) gets a bare "Steam app" label; the number alone tells a reader nothing.
    */
   private buildSteamFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      const slug = url.match(/\/app\/\d+\/([^/?#]+)/i)?.[1];
      const name = slug ? slug.replace(/_+/g, " ").trim() : "";
      return { ...card, title: name || "Steam app" };
   }

   /* --- TRELLO --- */

   private static readonly trelloCache = new Map<string, LinkMetadata>();

   /**
    * A Trello board, through the public JSON export any board's own URL answers to.
    *
    * Every Trello route - a board, a card, `/templates` - serves a non-browser request the
    * identical client-rendered shell: `<title>Trello</title>`, a generic "Organize anything,
    * together" meta description, no og tags at all. A live board and a dead one are
    * indistinguishable that way, exactly the Trello row this backlog item was opened for.
    *
    * Appending `.json` to a board's own URL (`trello.com/b/<shortLink>[.json]`) is a
    * long-standing, widely-used Trello behaviour: an anonymous read of the board's data for
    * any board whose visibility is public, no API key or auth needed. `?fields=name,desc,
    * url,prefs` trims the answer to a few KB - the unfiltered export carries every list and
    * card on the board (2.4 MB on a mid-sized one measured 2026-09-10). A board id that does
    * not exist answers a clean **404** `Board not found` - proof, so the card is built from
    * the URL rather than the shell's bare "Trello". A private board likely answers the same
    * way a missing one does (untested - nothing to probe it with), which is the right
    * fallback either way: nothing here is ours to read.
    *
    * Image = the board's own background photo when it has one (`prefs.backgroundImage`);
    * most boards use a flat colour instead and get no image, same as npm. Only a 404 is
    * proof; a non-200 or unparseable JSON fall through to generic. Only board URLs get this
    * - `/c/` cards answer `.json` with the same HTML shell, not real data, so they and every
    * other Trello route are a separate, unfixed gap. Session cache per board id, successes
    * only.
    */
   private async fetchTrello(url: string, refresh = false): Promise<LinkMetadata | undefined> {
      const shortLink = url.match(/trello\.com\/b\/([^/?#]+)/i)?.[1];
      if (!shortLink) return this.fetchGeneric(url);

      const cached = LinkMetadataFetcher.trelloCache.get(shortLink);
      if (cached && !refresh) return { ...cached, url };

      const res = await this.request(
         `https://trello.com/b/${shortLink}.json?fields=name,desc,url,prefs`,
         { "Accept": "application/json" }
      );

      if (res?.status === 404) {
         console.debug(`Trello has no board ${shortLink}; building a card from the URL.`);
         const card = this.buildUrlCard(url);
         // The shell every Trello route serves (title "Trello", a generic "Organize
         // anything, together" blurb) is furniture worth keeping even here - the same call
         // made for Steam's dead-app storefront. One direct request, never Microlink.
         const page = await this.request(url, { "Referer": "https://www.google.com/" });
         return page?.status === 200
            ? this.withParsedFurniture(card, url, await this.decodeHtmlContent(page.arrayBuffer, page.text))
            : card;
      }
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      let data: TrelloBoardResponse;
      try {
         data = JSON.parse(res.text) as TrelloBoardResponse;
      } catch {
         return this.fetchGeneric(url);
      }
      // The `.json` route answers 200 with the app shell's HTML for anything it doesn't
      // recognise as a board (see the /c/ card case above); guard against ever trusting that
      // as data.
      if (!data.name) return this.fetchGeneric(url);

      const card: LinkMetadata = {
         url,
         host: "trello.com",
         favicon: "https://trello.com/favicon.ico",
         indent: 0,
         title: LinkMetadataParser.sanitizeText(data.name, 300) ?? data.name,
         description: LinkMetadataParser.sanitizeText(data.desc, 300),
         image: data.prefs?.backgroundImage ?? undefined,
      };
      LinkMetadataFetcher.trelloCache.set(shortLink, card);
      return card;
   }

   /* --- GOOGLE DOCS / DRIVE --- */

   /**
    * Not a fetcher either, by the same rule as Maps: a public Doc, Sheet, Slide deck or
    * Drive file already reads perfectly on the generic path - real `og:title` (the
    * document's own name), `og:description` and a rendered thumbnail for the three Editor
    * types; a file gets its real filename and `og:site_name` "Google Docs", no thumbnail.
    * Confirmed 2026-09-10 against live public examples of all four. A missing id is a
    * clean, real 404 either way - Google does not distinguish "not there" from "no
    * permission" that way, which is the safe answer regardless of which it is - and the
    * existing 404 rule already builds an honest card from it.
    *
    * What the generic path gets wrong is a file or folder shared with **specific people**
    * rather than "anyone with the link": an anonymous request lands on Google's own
    * sign-in page, and - unlike LinkedIn's wall - `requestUrl` cannot see that as a
    * redirect (Obsidian exposes no final URL), and the wall carries no `og:*` tags at all
    * to give it away by content either; its title is also localised ("Accedi", "Sign in").
    * The one constant is structural: every real docs.google.com/drive.google.com page
    * omits `<base href>` entirely, while the sign-in page declares one pointing at
    * `accounts.google.com`. Two folders that looked identically "shared" answered
    * differently this way in testing - the honest confirmation that this is a real,
    * unpredictable case and not a hypothetical one.
    *
    * A folder or file's own URL carries no name, only an opaque id - there is nothing to
    * recover the way a Steam or TikTok URL's slug can, so the fallback is a plain label by
    * URL shape ("Google Docs document", "Google Drive folder", ...). The wall's own
    * (generic, identical every time) description rides along as furniture, same call as
    * Steam and Maps; its title does not, since "Sign in" is not the file's name.
    */
   private async fetchGoogleDocs(url: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(url, { "Referer": "https://www.google.com/" });

      // Measured directly (2026-09-10): a restricted file or folder answers a **raw 302**
      // to accounts.google.com, empty body, which `requestUrl` hands back exactly as sent
      // rather than following - unlike GitLab's redirect, which lands on a same-site
      // Cloudflare challenge. Checked before the 200 case below, since there is no body
      // here for `isGoogleSignInWall` to find anything in.
      const location = res && LinkMetadataFetcher.headerValue(res.headers, "location");
      if (res && res.status >= 300 && res.status < 400 && location && /^https:\/\/accounts\.google\.com\//i.test(location)) {
         console.debug(`Google redirected ${url} to its sign-in page.`);
         const card = this.buildGoogleDocsFallback(url);
         const wall = await this.request(location);
         return wall?.status === 200
            ? this.withParsedFurniture(card, url, await this.decodeHtmlContent(wall.arrayBuffer, wall.text))
            : card;
      }

      // Measured a second way in Obsidian itself (2026-09-10): the same restricted folder
      // that a scripted request outside Electron sees as a raw 302 came back as a bare
      // **401** here instead - `requestUrl` collapsing the redirect-to-a-login-wall chain
      // to a status rather than a body, one layer further than the 302 case above already
      // covers. Nothing else in this family legitimately 401s or 403s (a missing id is a
      // clean 404, checked below), so either status is read the same way: restricted, not
      // gone. Whatever body came with it is tried for furniture with no extra request -
      // `withParsedFurniture` is a safe no-op if it turns out to carry nothing.
      if (res && (res.status === 401 || res.status === 403)) {
         console.debug(`Google refused ${url} without authentication; treating it as restricted.`);
         const card = this.buildGoogleDocsFallback(url);
         const html = await this.decodeHtmlContent(res.arrayBuffer, res.text);
         return html ? this.withParsedFurniture(card, url, html) : card;
      }

      if (!res || res.status !== 200) {
         // Mirrors fetchGeneric's own non-200 handling rather than delegating to it, since
         // that would re-request the same url a second time - res is already the answer.
         console.debug(`Fetch failed for ${url}. Status: ${res?.status}`);
         if (res && (res.status === 404 || res.status === 410)) {
            return this.errorPageCard(url, await this.decodeHtmlContent(res.arrayBuffer, res.text));
         }
         return this.fetchFallback(url);
      }

      const html = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      // Belt and braces: if requestUrl ever does follow the redirect itself, the page it
      // lands on is this same sign-in page, recognisable by the one thing every real
      // docs.google.com/drive.google.com page omits - a <base href> - since the wall
      // carries no og:* tags and a localised title ("Accedi", "Sign in") to check instead.
      if (LinkMetadataFetcher.isGoogleSignInWall(html)) {
         console.debug(`Google served the sign-in page for ${url}.`);
         return this.withParsedFurniture(this.buildGoogleDocsFallback(url), url, html);
      }

      const metadata = await new LinkMetadataParser(url, html).parse();
      return metadata ?? this.buildGoogleDocsFallback(url);
   }

   private static isGoogleSignInWall(html: string): boolean {
      return /<base[^>]+href="https:\/\/accounts\.google\.com\//i.test(html);
   }

   private static headerValue(headers: Record<string, string>, name: string): string | undefined {
      const key = Object.keys(headers).find(k => k.toLowerCase() === name);
      return key ? headers[key] : undefined;
   }

   private static readonly GOOGLE_DOCS_LABELS: Record<string, string> = {
      document: "Google Docs document",
      spreadsheets: "Google Sheets spreadsheet",
      presentation: "Google Slides presentation",
      folder: "Google Drive folder",
      file: "Google Drive file",
   };

   private buildGoogleDocsFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      const kind = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\//i)?.[1]
         ?? (/\/drive\/folders\//i.test(url) ? "folder" : "file");
      return { ...card, title: LinkMetadataFetcher.GOOGLE_DOCS_LABELS[kind] ?? card.title };
   }

   /* --- GOOGLE MAPS --- */

   /**
    * Not a fetcher in the usual sense - there is no public endpoint for place data, and this
    * stays on the generic path. What it needs is the one correction the backlog already
    * named: every Maps page, a real place or one that cannot exist, declares `og:title`
    * "Google Maps" - nothing on the page ever names what was pasted, only the URL does.
    *
    * That is not proof of anything gone - a fake place answers exactly like a real one - so
    * this is an unconditional tell rather than a `goneCard` in the usual sense: this site's
    * title is simply never worth keeping, live or not. `og:image` is, though, and it is
    * better than most furniture: Maps renders a **Static Maps API** thumbnail centred on the
    * URL's own coordinates, so it is specific to this place, not generic chrome. The
    * `og:description` ("Find local businesses, view maps and get driving directions...") is
    * generic - identical for every Maps link - and rides along anyway, the same call Roberto
    * made for Steam's storefront blurb: what is wrong with a shell is its title, not its
    * furniture.
    */
   private fetchGoogleMaps(url: string): Promise<LinkMetadata | undefined> {
      return this.fetchGeneric(url, {
         goneCard: (metadata) => {
            if (metadata.title.trim().toLowerCase() !== "google maps") return undefined;
            return this.withPageFurniture(this.buildGoogleMapsFallback(url), metadata);
         },
      });
   }

   private buildGoogleMapsFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      const name = LinkMetadataFetcher.googleMapsPlaceName(url);
      // The page declares no og:site_name, and google.com hosts too many other things
      // (Docs, Drive, Search) to earn a host-wide SITE_NAMES floor - that would mislabel
      // every one of them as Maps. Set here instead, precise to a URL already known to be
      // a Maps link, so a markdown-link label still gets "- Google Maps" appended.
      return { ...card, siteName: "Google Maps", title: name ?? card.title };
   }

   /**
    * The page never names the place, so the URL is the only source: `/maps/place/<name>/…`
    * and `/maps/search/<query>/…` carry it as a path segment, a bare `?q=` as a query
    * param. Google keeps the place's own capitalisation in both, so this only turns `+` back
    * into spaces and decodes - no deslugging, unlike a URL where the site invented the slug.
    */
   private static googleMapsPlaceName(url: string): string | undefined {
      const segment = url.match(/\/maps\/(?:place|search)\/([^/?#]+)/i)?.[1];
      let raw = segment;
      if (!raw) {
         try {
            raw = new URL(url).searchParams.get("q") ?? undefined;
         } catch {
            raw = undefined;
         }
      }
      if (!raw) return undefined;
      try {
         return decodeURIComponent(raw.replace(/\+/g, " ")).trim() || undefined;
      } catch {
         return raw.replace(/\+/g, " ").trim() || undefined;
      }
   }

   /* --- SPOTIFY --- */
   private async fetchSpotify(url: string): Promise<LinkMetadata | undefined> {
      // Normalize: strip locale prefix (intl-it/, intl-en/, …) and tracking params
      const parsed = new URL(url);
      const cleanPath = parsed.pathname.replace(/^\/intl-[a-z]+\//, "/");
      const typeMatch = cleanPath.match(/^\/(track|album|playlist|artist|episode)\//);
      if (!typeMatch) return this.fetchGeneric(url);
      const cleanUrl = `https://open.spotify.com${cleanPath}`.replace(/\?.*$/, "");
      const typeLabels: Record<string, string> = {
         track: "Track", album: "Album", playlist: "Playlist", artist: "Artist", episode: "Episode",
      };
      const typeLabel = typeLabels[typeMatch[1]!] ?? typeMatch[1]!;

      // Prefer the page itself: it carries the artist, the album, the release year and a
      // ready-made localised label, none of which the oEmbed response has.
      const fromPage = await this.fetchSpotifyPage(url);
      if (fromPage) return fromPage;

      const res = await this.request(
         `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
         {
            "Accept": "application/json",
            "Referer": "https://open.spotify.com/",
         }
      );
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      let data: Record<string, unknown>;
      try {
         data = JSON.parse(res.text) as Record<string, unknown>;
      } catch {
         return this.fetchGeneric(url);
      }

      const title = typeof data.title === "string"
         ? (LinkMetadataParser.sanitizeText(data.title) ?? data.title)
         : undefined;
      if (!title) return this.fetchGeneric(url);

      const author = typeof data.author_name === "string" ? data.author_name : undefined;
      const image = typeof data.thumbnail_url === "string" ? data.thumbnail_url : undefined;
      const description = author ? `${typeLabel} · ${author}` : typeLabel;

      return {
         url,
         title,
         author,
         description,
         host: "open.spotify.com",
         favicon: "https://open.spotify.com/favicon.ico",
         image,
         indent: 0,
      };
   }

   /**
    * Spotify only server-renders a page for clients that aren't a modern browser: with a
    * normal Chrome user agent it answers with the empty web-player shell. Identifying the
    * plugin plainly gets the real markup, in the user's own language.
    */
   private async fetchSpotifyPage(url: string): Promise<LinkMetadata | undefined> {
      // Requested as pasted, locale prefix included: the canonical /track/<id> form answers
      // 302 to the localised path, and the localised page is the one worth having.
      const res = await this.request(url, {
         "User-Agent": "Mozilla/5.0 (compatible; ObsidianAutoCardLink/1.0; +https://github.com/KreNtal/obsidian-auto-card-link)",
      });
      if (!res || res.status !== 200 || !res.text) return undefined;

      const doc = new DOMParser().parseFromString(res.text, "text/html");
      const meta = (property: string): string | undefined =>
         doc.querySelector(`meta[property='${property}']`)?.getAttribute("content")?.trim() || undefined;

      const pageTitle = doc.querySelector("title")?.textContent?.trim();
      const ogTitle = meta("og:title");
      // The shell renders as "Spotify - Web Player: Music for everyone"
      if (!ogTitle || !pageTitle || /web player/i.test(pageTitle)) return undefined;

      const { author, description } = this.splitSpotifyMeta(meta("og:description"), pageTitle, meta("og:type"));

      return {
         url,
         title: LinkMetadataParser.sanitizeText(this.spotifyName(ogTitle), 300) ?? ogTitle,
         author: LinkMetadataParser.sanitizeText(author),
         description: LinkMetadataParser.sanitizeText(description),
         host: "open.spotify.com",
         favicon: "https://open.spotify.com/favicon.ico",
         image: meta("og:image"),
         // Spotify writes a better inline label than we could compose, already translated:
         // "Execution - musica e testo di X | Spotify", "Enter the void - playlist by Y | Spotify"
         linkTitle: LinkMetadataParser.sanitizeText(pageTitle, 300),
         indent: 0,
      };
   }

   /** Album pages put the whole page title in og:title ("Name - Album di X | Spotify"). */
   private spotifyName(ogTitle: string): string {
      const suffix = ogTitle.match(/\s*\|\s*[^|]*Spotify\s*$/i);
      if (!suffix?.[0]) return ogTitle;

      const withoutSuffix = ogTitle.slice(0, ogTitle.length - suffix[0].length).trim();
      const lastDash = withoutSuffix.lastIndexOf(" - ");
      return lastDash > 0 ? withoutSuffix.slice(0, lastDash).trim() : withoutSuffix;
   }

   /**
    * og:description packs the creator and the details into one localised string, with the
    * shape depending on what the page is:
    *   album    "Joji · Album · 2026 · 22 brani"
    *   track    "Artist · Album · Brano · 2026"
    *   episode  "Show · Episode"
    *   artist   "Artista · 27.5M ascoltatori mensili."   (opens with the type, not a name)
    *   playlist "my darkest soul"                    (the playlist's own description)
    */
   private splitSpotifyMeta(
      description: string | undefined,
      pageTitle: string,
      ogType: string | undefined
   ): { author?: string; description?: string; } {
      const parts = description?.split("·").map(p => p.trim()).filter(Boolean) ?? [];

      // An artist page opens with the type label, so there is no separate creator to pull out
      if (parts.length > 1 && ogType !== "profile") {
         return { author: parts[0], description: parts.slice(1).join(" · ") };
      }

      return { author: this.spotifyOwnerFromTitle(pageTitle), description };
   }

   /** A playlist names its owner only in the page title: "Name - playlist by Owner | Spotify". */
   private spotifyOwnerFromTitle(pageTitle: string): string | undefined {
      const withoutSuffix = pageTitle.replace(/\s*\|\s*[^|]*Spotify\s*$/i, "").trim();
      const lastDash = withoutSuffix.lastIndexOf(" - ");
      if (lastDash < 0) return undefined;

      const descriptor = withoutSuffix.slice(lastDash + 3).trim();
      return descriptor.match(/(?:by|di|de|von|par|de la)\s+(.+)$/i)?.[1]?.trim();
   }

   /* --- WIKIPEDIA --- */
   private async fetchWikipedia(url: string): Promise<LinkMetadata | undefined> {
      const parsed = new URL(url);
      const lang = parsed.hostname.split(".")[0] ?? "en";
      const title = decodeURIComponent(parsed.pathname.replace(/^\/wiki\//, ""));

      const res = await this.request(
         `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      const data = JSON.parse(res.text) as WikipediaSummaryResponse;
      return {
         url: data.content_urls?.desktop?.page ?? url,
         title: data.title ?? title,
         description: LinkMetadataParser.sanitizeText(data.extract),
         host: `${lang}.wikipedia.org`,
         favicon: `https://${lang}.wikipedia.org/favicon.ico`,
         image: data.thumbnail?.source ?? data.originalimage?.source ?? undefined,
         indent: 0,
      };
   }

   /* --- ARXIV --- */

   // arXiv's own og:image. A paper has no figure of its own, and the homepage carries no
   // og:* tags at all, so both lean on this. The version segment can move on a frontend
   // release; a stale URL just 404s and the card drops the thumbnail.
   private static readonly ARXIV_LOGO = "https://arxiv.org/static/browse/0.3.4/images/arxiv-logo-fb.png";

   private async fetchArxiv(url: string): Promise<LinkMetadata | undefined> {
      // arxiv.org/(abs|pdf|format|html)/<id>, where <id> is "1706.03762", "1706.03762v3", or
      // an old-style "hep-th/9901001". A trailing ".pdf" and any query/hash aren't part of it.
      const id = url
         .match(/arxiv\.org\/(?:abs|pdf|format|html)\/([^\s?#]+)/i)?.[1]
         ?.replace(/\.pdf$/i, "");
      if (!id) return this.arxivGeneric(url);

      // The Atom API returns one <entry> with the full abstract, the author list and the date
      // - the abs page only has a truncated og:description and "Last, First" author names.
      const res = await this.request(
         `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`
      );
      if (!res || res.status !== 200) return this.arxivGeneric(url);

      // A well-formed id with no <entry> is a paper that isn't there. The generic path would
      // read arXiv's 404 and end up titled after the URL's route segment ("Abs"); the id
      // itself is the citation form a reader recognises.
      const entry = res.text.split("<entry>")[1]?.split("</entry>")[0];
      if (!entry) return this.arxivIdCard(url, id);

      const clean = (raw: string | undefined) => this.decodeXmlText(raw)?.replace(/\s+/g, " ").trim();
      const title = clean(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
      const summary = clean(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]);
      if (!title) return this.arxivIdCard(url, id);

      const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)]
         .map(m => clean(m[1]))
         .filter((n): n is string => !!n);
      const author = authors.length === 0
         ? undefined
         : authors.length <= 2
            ? authors.join(" and ")
            : `${authors[0]} et al.`;

      return {
         url,
         title: LinkMetadataParser.sanitizeText(title, 300) ?? title,
         author,
         description: LinkMetadataParser.sanitizeText(summary),
         host: "arxiv.org",
         favicon: "https://arxiv.org/favicon.ico",
         image: LinkMetadataFetcher.ARXIV_LOGO,
         indent: 0,
      };
   }

   private arxivIdCard(url: string, id: string): LinkMetadata {
      return {
         url,
         title: `arXiv:${id}`,
         host: "arxiv.org",
         favicon: "https://arxiv.org/favicon.ico",
         image: LinkMetadataFetcher.ARXIV_LOGO,
         indent: 0,
      };
   }

   /**
    * Anything on arxiv.org the Atom API can't answer for — the homepage above all.
    *
    * The page reads fine generically (a `<title>` and a meta description, no og:* tags at
    * all), so the only thing missing is the logo the paper cards already carry.
    */
   private async arxivGeneric(url: string): Promise<LinkMetadata | undefined> {
      const metadata = await this.fetchGeneric(url);
      if (!metadata) return metadata;
      return {
         ...metadata,
         image: metadata.image ?? LinkMetadataFetcher.ARXIV_LOGO,
         favicon: metadata.favicon ?? "https://arxiv.org/favicon.ico",
      };
   }

   /* --- STACK EXCHANGE --- */

   // Every Stack Exchange site (stackoverflow.com, superuser.com, math.stackexchange.com, …)
   // now 403s a non-browser request and microlink can't get through either, so the card is
   // built from api.stackexchange.com instead - one endpoint, `?site=<name>`, no auth. The
   // anonymous quota is 300/day/IP, hence the session cache.
   private static readonly stackExchangeCache = new Map<string, LinkMetadata>();

   private stackExchangeSite(hostname: string): string | undefined {
      const host = hostname.toLowerCase().replace(/^www\./, "");
      const named: Record<string, string> = {
         "stackoverflow.com": "stackoverflow",
         "serverfault.com": "serverfault",
         "superuser.com": "superuser",
         "askubuntu.com": "askubuntu",
         "stackapps.com": "stackapps",
         "mathoverflow.net": "mathoverflow",
      };
      if (named[host]) return named[host];
      // math.stackexchange.com → "math", meta.stackoverflow.com → "meta.stackoverflow"
      const m = host.match(/^(.+)\.stackexchange\.com$/);
      if (m) return m[1];
      const meta = host.match(/^meta\.(stackoverflow|serverfault|superuser|askubuntu)\.com$/);
      return meta ? `meta.${meta[1]}` : undefined;
   }

   private async fetchStackExchange(url: string): Promise<LinkMetadata | undefined> {
      let parsed: URL;
      try { parsed = new URL(url); } catch { return this.fetchGeneric(url); }

      const site = this.stackExchangeSite(parsed.hostname);
      if (!site) return this.fetchGeneric(url);

      if (CheckIf.isStackExchangeSiteUrl(url)) {
         return (await this.stackExchangeSiteCard(site, url)) ?? this.fetchGeneric(url);
      }

      const path = parsed.pathname + parsed.hash;
      let questionId = path.match(/\/(?:questions|q)\/(\d+)/)?.[1];
      const answerId = path.match(/\/a\/(\d+)/)?.[1]
         ?? path.match(/\/questions\/\d+\/[^/]+\/(\d+)(?:$|[?#])/)?.[1]
         ?? path.match(/#(?:answer-)?(\d+)/)?.[1];

      // An answer link names an answer, not the question. Resolve it: it always yields the
      // question id (needed for the /a/<id> form, which carries nothing else) and the answer's
      // author, shown as an "Answer by …" note on top of the question card.
      let answerNote: string | undefined;
      if (answerId && answerId !== questionId) {
         const ans = await this.stackExchangeApi(`answers/${answerId}`, site);
         const item = ans?.items?.[0] as { question_id?: number; owner?: { display_name?: string; }; } | undefined;
         if (item?.question_id) {
            questionId = String(item.question_id);
            answerNote = item.owner?.display_name ? `Answer by ${item.owner.display_name}` : "Linked to an answer";
         } else if (!questionId) {
            // An empty `items` is the API stating the answer is deleted or never existed; a
            // failed call carries no `items` at all and proves nothing. See below for why the
            // difference is worth the branch.
            return Array.isArray(ans?.items) ? this.buildUrlCard(url) : this.fetchGeneric(url);
         }
      }

      if (!questionId) return this.fetchGeneric(url);

      // The cache holds the plain question card; the answer note is layered on afterwards, so a
      // /q link and a /a link to the same question share the cached fetch but read differently.
      const base = await this.stackExchangeQuestionCard(site, questionId, parsed.hostname);
      // Every SE page answers a non-browser request with 403, live or deleted alike, so
      // fetchGeneric cannot tell the two apart and spends a Microlink request either way -
      // on the one link where the API has already given a definitive answer. The URL's own
      // slug says more than that render would ("This question does not exist" beats a
      // rate-limit notice), and it costs nothing.
      if (base === "absent") return this.buildUrlCard(url);
      if (!base) return this.fetchGeneric(url);

      const description = answerNote
         ? LinkMetadataParser.sanitizeText(`${answerNote} · ${base.description ?? ""}`)
         : base.description;
      return { ...base, url, description };
   }

   /**
    * `"absent"` is the API answering with an empty `items`: the question is deleted or never
    * existed, which is proof rather than a failure. `undefined` is the call itself not getting
    * through (quota, network, a 400), which proves nothing and must stay on the generic path.
    * Only the first may be turned into a card built from the URL - see the caller.
    */
   private async stackExchangeQuestionCard(
      site: string, questionId: string, hostname: string
   ): Promise<LinkMetadata | "absent" | undefined> {
      const cacheKey = `${site}:${questionId}`;
      const cached = LinkMetadataFetcher.stackExchangeCache.get(cacheKey);
      if (cached) return cached;

      const json = await this.stackExchangeApi(`questions/${questionId}`, site, "withbody");
      const q = json?.items?.[0] as {
         title?: string; body?: string;
         score?: number; answer_count?: number; is_answered?: boolean;
         owner?: { display_name?: string; };
      } | undefined;
      // Not cached either way: a deleted question may be undeleted, and a failed call says
      // nothing about tomorrow.
      if (!q?.title) return Array.isArray(json?.items) ? "absent" : undefined;

      const stats = [
         this.countLabel(q.score ?? 0, "vote"),
         `${this.countLabel(q.answer_count ?? 0, "answer")}${q.is_answered ? " ✓" : ""}`,
      ].join(" · ");
      const excerpt = q.body
         ? this.decodeXmlText(q.body.replace(/<[^>]+>/g, " "))?.replace(/\s+/g, " ").trim()
         : undefined;
      const host = hostname.replace(/^www\./, "");

      const card: LinkMetadata = {
         url: `https://${host}/questions/${questionId}`,
         title: LinkMetadataParser.sanitizeText(this.decodeXmlText(q.title) ?? q.title, 300) ?? q.title,
         author: q.owner?.display_name,
         description: LinkMetadataParser.sanitizeText([stats, excerpt].filter(Boolean).join(" · ")),
         host,
         favicon: `https://${host}/favicon.ico`,
         // No image. The page's real og:image is behind the 403, and every SE site's only
         // other mark is its apple-touch-icon - the favicon at a larger size, which the card
         // would then show twice. An imageless card is the honest one.
         indent: 0,
      };
      LinkMetadataFetcher.stackExchangeCache.set(cacheKey, card);
      return card;
   }

   /**
    * The card for a network site's front page.
    *
    * `/2.3/sites` describes all 365 of them in one (site-less) call — name, audience and the
    * icon set — so a single request covers every SE homepage the vault will ever hold, and
    * it answers even though the pages themselves 403 us.
    */
   private async stackExchangeSiteCard(site: string, url: string): Promise<LinkMetadata | undefined> {
      const info = (await this.stackExchangeSites())?.get(site);
      if (!info?.name) return undefined;

      const name = this.decodeXmlText(info.name) ?? info.name;
      const audience = info.audience ? this.decodeXmlText(info.audience) ?? info.audience : undefined;
      const host = info.site_url?.replace(/^https?:\/\//, "").replace(/\/$/, "")
         ?? new URL(url).hostname.replace(/^www\./, "");

      return {
         url,
         title: LinkMetadataParser.sanitizeText(name, 300) ?? name,
         description: audience
            ? LinkMetadataParser.sanitizeText(`Q&A for ${audience}`)
            : undefined,
         host,
         favicon: info.favicon_url ?? `https://${host}/favicon.ico`,
         // The square site mark, at the 2x size. Unlike `logo_url` (a wide wordmark that the
         // thumbnail slot would crop to a fragment) it fills the tile as-is.
         //
         // `thumbnailQuality` doesn't branch here: 2x is 300px, still under what the 200px
         // slot wants on a retina display, so it is both the best-looking size and the
         // largest one the API offers. The 1x `icon_url` would only ever be the softer of
         // the two, never the smaller-and-good-enough the "Best looking" option promises.
         image: info.high_resolution_icon_url ?? info.icon_url,
         indent: 0,
      };
   }

   private static stackExchangeSiteList: Map<string, StackExchangeSite> | undefined;

   private async stackExchangeSites(): Promise<Map<string, StackExchangeSite> | undefined> {
      if (LinkMetadataFetcher.stackExchangeSiteList) return LinkMetadataFetcher.stackExchangeSiteList;

      const json = await this.stackExchangeJson("sites?pagesize=500");
      const items = json?.items as StackExchangeSite[] | undefined;
      if (!items?.length) return undefined;

      const map = new Map<string, StackExchangeSite>();
      for (const item of items) {
         if (item.api_site_parameter) map.set(item.api_site_parameter, item);
      }
      LinkMetadataFetcher.stackExchangeSiteList = map;
      return map;
   }

   private stackExchangeApi(
      pathAndId: string, site: string, filter?: string
   ): Promise<{ items?: unknown[]; quota_remaining?: number; } | undefined> {
      const qs = `site=${encodeURIComponent(site)}${filter ? `&filter=${filter}` : ""}`;
      return this.stackExchangeJson(`${pathAndId}?${qs}`);
   }

   private async stackExchangeJson(
      pathAndQuery: string
   ): Promise<{ items?: unknown[]; quota_remaining?: number; } | undefined> {
      const res = await this.request(`https://api.stackexchange.com/2.3/${pathAndQuery}`, {
         "Accept": "application/json",
      });
      if (!res || res.status !== 200) return undefined;
      try {
         return JSON.parse(res.text) as { items?: unknown[]; quota_remaining?: number; };
      } catch {
         return undefined;
      }
   }

   private countLabel(n: number, noun: string): string {
      const abs = Math.abs(n);
      // "reply" -> "replies", not "replys". A consonant before the y is what distinguishes
      // it from "day"/"days".
      const plural = /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
      const label = abs === 1 ? noun : plural;
      const value = abs >= 1_000_000
         ? `${(n / 1_000_000).toFixed(1)}M`
         : abs >= 1000
            ? `${(n / 1000).toFixed(1)}k`
            : String(n);
      return `${value} ${label}`;
   }

   /* --- ENCODING --- */
   private async decodeHtmlContent(arrayBuffer: ArrayBuffer, fallbackText: string): Promise<string> {
      try {
         const uint8Array = new Uint8Array(arrayBuffer);
         const sampleText = new TextDecoder("utf-8", { fatal: false }).decode(uint8Array.slice(0, 2048));

         const charsetMatch = sampleText.match(
            /<meta[^>]+(?:charset=["']?([^"'>\s]+)["']?|content=["'][^"']*charset=([^"'>\s;]+))/i
         );
         const detectedCharset = (charsetMatch?.[1] ?? charsetMatch?.[2])?.toLowerCase();

         if (detectedCharset) {
            const normalized = this.normalizeCharset(detectedCharset);
            if (normalized !== "utf-8") {
               try {
                  return new TextDecoder(normalized, { fatal: true }).decode(uint8Array);
               } catch {
                  // fall through
               }
            }
         }

         if (this.isGarbledText(fallbackText)) {
            for (const encoding of ["shift_jis", "euc-kr", "euc-jp", "iso-2022-jp"]) {
               try {
                  const decoded = new TextDecoder(encoding, { fatal: true }).decode(uint8Array);
                  if (!this.isGarbledText(decoded)) return decoded;
               } catch {
                  // try next
               }
            }
         }

         return fallbackText;
      } catch {
         return fallbackText;
      }
   }

   /* --- SHARED HELPERS --- */
   private formatDuration(seconds: number | undefined): string | undefined {
      if (!seconds || isNaN(seconds)) return undefined;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return h > 0
         ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
         : `${m}:${String(s).padStart(2, "0")}`;
   }

   private extractIso8601Duration(html: string): string | undefined {
      // JSON-LD VideoObject: "duration":"PT18M54S"
      const match = html.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
      if (!match) return undefined;
      const h = parseInt(match[1] ?? "0") || 0;
      const m = parseInt(match[2] ?? "0") || 0;
      const s = parseInt(match[3] ?? "0") || 0;
      return this.formatDuration(h * 3600 + m * 60 + s);
   }

   private normalizeCharset(charset: string): string {
      const key = charset.toLowerCase().replace(/[-_]/g, "");
      const map: Record<string, string> = {
         shiftjis: "shift_jis",
         sjis: "shift_jis",
         xsjis: "shift_jis",
         euckr: "euc-kr",
         ksc56011987: "euc-kr",
         eucjp: "euc-jp",
         iso2022jp: "iso-2022-jp",
         utf8: "utf-8",
         iso88591: "iso-8859-1",
         latin1: "iso-8859-1",
      };
      return map[key] ?? charset;
   }

   private isGarbledText(text: string): boolean {
      if (/�/.test(text)) return true;
      if (/\?{3,}/.test(text)) return true;
      const suspicious = text.match(/[À-ɏ]/g);
      return suspicious !== null && suspicious.length / text.length > 0.1;
   }

   /**
    * Asks sites for the user's own language. Hardcoding English here meant an Italian
    * user linking amazon.it got an English title back for an Italian page. Handlers that
    * parse English strings out of the response (Twitch) still pass an explicit override.
    */
   private acceptLanguage(): string {
      const locale = navigator.language || "en-US";
      const base = locale.split("-")[0] ?? "en";
      const parts = [locale];
      if (base !== locale) parts.push(`${base};q=0.9`);
      if (base !== "en") parts.push("en;q=0.8");
      return parts.join(",");
   }

   /**
    * A custom header set to `undefined` (rather than omitted) drops that header from the
    * request entirely, instead of falling back to its default below - the way a caller opts
    * out of, say, the default Accept-Language rather than merely not overriding it.
    */
   /* --- BLUESKY --- */

   /**
    * Bluesky, through the public AppView - no auth, no key, no quota.
    *
    * bsky.app does serve real `og:*`, so the generic path already reads a post: the title is
    * "<name> (@<handle>)", the description is the post's text, the image is the attached photo
    * or the author's avatar. This path exists for what those tags cannot say:
    *
    *   - a deleted post answers 200 with **no og tags at all**, so the generic read comes back
    *     titled just "Bluesky", a card that says nothing while looking like it does;
    *   - likes, reposts and replies exist only in the API.
    *
    * The URL's handle can go straight into the at:// URI - the AppView resolves it - so a post
    * costs one request, not a handle-to-DID round trip first.
    */
   private async fetchBluesky(url: string): Promise<LinkMetadata | undefined> {
      const path = url.match(/bsky[.]app\/profile\/([^/?#]+)(?:\/post\/([^/?#]+))?/i);
      const actor = path?.[1] ? decodeURIComponent(path[1]) : undefined;
      if (!actor) return this.fetchGeneric(url);

      return path?.[2]
         ? this.blueskyPostCard(url, actor, path[2])
         : this.blueskyProfileCard(url, actor);
   }

   private async blueskyPostCard(url: string, actor: string, rkey: string): Promise<LinkMetadata> {
      const uri = `at://${actor}/app.bsky.feed.post/${rkey}`;
      const json = await this.blueskyJson<{ thread?: { post?: BlueskyPost; }; }>(
         `app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`
      );
      const post = json?.thread?.post;
      if (!post?.author?.handle) return this.blueskyFallback(url, actor);

      const handle = post.author.handle;
      const counts = [
         this.countLabel(post.likeCount ?? 0, "like"),
         this.countLabel(post.repostCount ?? 0, "repost"),
         this.countLabel(post.replyCount ?? 0, "reply"),
      ].join(" · ");
      const text = this.blueskyText(post.record?.text);
      const images = post.embed?.images ?? post.embed?.media?.images;

      return {
         url,
         title: `${post.author.displayName?.trim() || handle} (@${handle})`,
         // The text leads, unlike Stack Exchange and Hacker News where the counts do: there the
         // title carries the content and the description is context, here the title is only
         // the author. Which means the text is what runs long, so it is trimmed to leave room
         // for the counts - trimming the joined string instead cut it mid-separator and left
         // a card ending in "· ...".
         description: LinkMetadataParser.sanitizeText(
            [this.fitBefore(text, counts), counts].filter(Boolean).join(" · ")
         ),
         host: "bsky.app",
         // bsky.app/favicon.ico is a 404 - the icon only exists under /static/.
         favicon: "https://bsky.app/static/favicon-32x32.png",
         // The post's own picture when it has one, the link card's thumbnail when it is a
         // link, and the author's avatar otherwise - which is what Bluesky's own og:image does.
         image: images?.[0]?.thumb ?? post.embed?.external?.thumb ?? post.author.avatar,
         indent: 0,
      };
   }

   private async blueskyProfileCard(url: string, actor: string): Promise<LinkMetadata> {
      const profile = await this.blueskyJson<BlueskyProfile>(
         `app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`
      );
      if (!profile?.handle) return this.blueskyFallback(url, actor);

      const bio = this.blueskyText(profile.description);
      const followers = this.countLabel(profile.followersCount ?? 0, "follower");

      return {
         url,
         title: `${profile.displayName?.trim() || profile.handle} (@${profile.handle})`,
         description: LinkMetadataParser.sanitizeText(
            [this.fitBefore(bio, followers), followers].filter(Boolean).join(" · ")
         ),
         host: "bsky.app",
         favicon: "https://bsky.app/static/favicon-32x32.png",
         // The banner is the wide image a profile actually presents; the avatar is the
         // fallback, and the only thing a profile without a banner has.
         image: profile.banner ?? profile.avatar,
         indent: 0,
      };
   }

   /**
    * A post's text and a profile's bio are written in paragraphs. Flattening every run of
    * whitespace to one space runs the paragraphs together into one sentence that reads as a
    * mistake; a blank line becomes the same separator the rest of the card uses.
    */
   private blueskyText(text: string | undefined): string | undefined {
      const flat = text
         ?.replace(/\s*\n\s*\n\s*/g, " · ")
         .replace(/\s+/g, " ")
         .trim();
      return flat || undefined;
   }

   /**
    * Trims `text` so that it and `tail` together still fit a card description: room has to be
    * left for the " · " that joins them *and* for the "..." sanitizeText adds when it
    * cuts, or the join overruns the limit and gets cut a second time - which is what put a
    * truncated count on the end of a long post.
    */
   private fitBefore(text: string | undefined, tail: string, limit = 300): string | undefined {
      if (!text) return undefined;
      const room = limit - tail.length - " · ".length - "...".length;
      return room >= 40 ? LinkMetadataParser.sanitizeText(text, room) : text;
   }

   private async blueskyJson<T>(pathAndQuery: string): Promise<T | undefined> {
      const res = await this.request(`https://public.api.bsky.app/xrpc/${pathAndQuery}`, {
         "Accept": "application/json",
      });
      if (!res || res.status !== 200) return undefined;
      try {
         return JSON.parse(res.text) as T;
      } catch {
         return undefined;
      }
   }

   /** A deleted post or an unknown handle. The URL still names who was being read. */
   private blueskyFallback(url: string, actor: string): LinkMetadata {
      return {
         url,
         title: actor.startsWith("did:") ? "Bluesky" : `@${actor}`,
         host: "bsky.app",
         favicon: "https://bsky.app/static/favicon-32x32.png",
         indent: 0,
      };
   }

   /* --- HACKER NEWS --- */

   /**
    * Hacker News, through its official Firebase API: open, unauthenticated, no quota.
    *
    * The API is the only way to get a story's score and comment count. The site itself
    * serves plain HTML with no `og:*` tags at all, so the generic path can read nothing but
    * `<title>`, which is "<story title> | Hacker News" - the title, and no more.
    *
    * A missing item is not a 404: the API answers 200 with the literal `null`, so the check
    * is on the body, not the status.
    */
   private async fetchHackerNews(url: string): Promise<LinkMetadata | undefined> {
      const user = url.match(/[?&]id=([^&#]+)/i)?.[1];
      if (/\/user[?]/i.test(url)) {
         return this.hackerNewsUserCard(url, decodeURIComponent(user ?? ""));
      }

      const id = url.match(/[?&]id=(\d+)/i)?.[1];
      if (!id) return this.fetchGeneric(url);

      const item = await this.hackerNewsItem(id);
      if (!item) return this.hackerNewsFallback(url, "Hacker News item");

      // A comment carries no title of its own. Its story does, and that is what a reader
      // pasting the link is pointing at - so walk up to it. The chain is short in practice
      // but unbounded in principle, hence the hop limit; past it the comment still gets a
      // card, just without the story's name on it.
      if (item.type === "comment") return this.hackerNewsCommentCard(url, item);

      return this.hackerNewsItemCard(url, item);
   }

   private hackerNewsItemCard(url: string, item: HackerNewsItem): LinkMetadata {
      const parts: string[] = [];
      // A job ad has a token score of 1 and no comments; saying "1 point, 0 comments" about
      // it is noise dressed as data.
      if (item.type !== "job") {
         parts.push(this.countLabel(item.score ?? 0, "point"));
         parts.push(this.countLabel(item.descendants ?? 0, "comment"));
      }
      // The domain a story points at, the way Hacker News itself labels its links.
      const target = this.hackerNewsTargetHost(item.url);
      if (target) parts.push(target);
      const body = this.hackerNewsText(item.text);
      if (body) parts.push(body);

      return {
         url,
         title: LinkMetadataParser.sanitizeText(item.title, 300) ?? item.title ?? "Hacker News",
         author: item.by,
         description: LinkMetadataParser.sanitizeText(parts.join(" · ")),
         host: "news.ycombinator.com",
         favicon: "https://news.ycombinator.com/favicon.ico",
         indent: 0,
      };
   }

   private async hackerNewsCommentCard(url: string, comment: HackerNewsItem): Promise<LinkMetadata> {
      let root: HackerNewsItem | undefined = comment;
      for (let hop = 0; hop < 5 && root?.type === "comment" && root.parent !== undefined; hop++) {
         root = await this.hackerNewsItem(String(root.parent));
      }
      const storyTitle = root?.type !== "comment" ? root?.title : undefined;
      const body = this.hackerNewsText(comment.text);

      return {
         url,
         title: LinkMetadataParser.sanitizeText(storyTitle, 300) ?? storyTitle ?? "Hacker News comment",
         author: comment.by,
         description: LinkMetadataParser.sanitizeText(["Comment", body].filter(Boolean).join(" · ")),
         host: "news.ycombinator.com",
         favicon: "https://news.ycombinator.com/favicon.ico",
         indent: 0,
      };
   }

   private async hackerNewsUserCard(url: string, name: string): Promise<LinkMetadata> {
      const res = name
         ? await this.request(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(name)}.json`)
         : undefined;
      const user = this.hackerNewsJson<HackerNewsUser>(res);
      if (!user?.id) return this.hackerNewsFallback(url, name || "Hacker News user");

      // Hacker News says "karma", uncountable, and shows the exact number - so no k-shortening.
      const parts = [`${user.karma ?? 0} karma`];
      const about = this.hackerNewsText(user.about);
      if (about) parts.push(about);

      return {
         url,
         title: user.id,
         description: LinkMetadataParser.sanitizeText(parts.join(" · ")),
         host: "news.ycombinator.com",
         favicon: "https://news.ycombinator.com/favicon.ico",
         indent: 0,
      };
   }

   private async hackerNewsItem(id: string): Promise<HackerNewsItem | undefined> {
      const res = await this.request(`https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(id)}.json`);
      const item = this.hackerNewsJson<HackerNewsItem>(res);
      // Deleted and dead items still return an object, with nothing worth showing in it.
      return item && !item.deleted && !item.dead ? item : undefined;
   }

   private hackerNewsJson<T>(res: { status: number; text: string; } | undefined): T | undefined {
      if (!res || res.status !== 200) return undefined;
      try {
         return (JSON.parse(res.text) as T | null) ?? undefined;
      } catch {
         return undefined;
      }
   }

   /** The story's own body, a job ad, a comment: HTML with entities, flattened to one line. */
   private hackerNewsText(text: string | undefined): string | undefined {
      if (!text) return undefined;
      const flat = this.decodeXmlText(
         text.replace(/<p>/gi, " ").replace(/<[^>]+>/g, " ")
      )?.replace(/\s+/g, " ").trim();
      return flat || undefined;
   }

   private hackerNewsTargetHost(target: string | undefined): string | undefined {
      if (!target) return undefined;
      try {
         return new URL(target).hostname.replace(/^www[.]/i, "");
      } catch {
         return undefined;
      }
   }

   private hackerNewsFallback(url: string, title: string): LinkMetadata {
      return {
         url,
         title,
         host: "news.ycombinator.com",
         favicon: "https://news.ycombinator.com/favicon.ico",
         indent: 0,
      };
   }

   /**
    * LinkedIn.
    *
    * There is no API without OAuth, but the pages do describe themselves to an anonymous
    * request: the login wall a browser hits does not stop the og:* tags from being served.
    * Two things make this worth its own path rather than `fetchGeneric`, both checked
    * 2026-09-03:
    *
    *   - `/school/<name>` answers our normal browser UA with HTTP 999 - LinkedIn's own
    *     throttle code - and a 1.5 KB stub, while the identical request with a crawler UA
    *     returns the full 264 KB page. `/company/`, `/in/`, `/posts/`, `/feed/update/` and
    *     `/events/` answer either way, so the crawler UA is simply the form that works
    *     everywhere.
    *   - the titles carry LinkedIn's own furniture. A post is titled
    *     `<text> | <author> | <n> comments`, a profile or company `<name> | LinkedIn`. The
    *     comment count is noise that is stale the day after it is written into a note, and
    *     the author belongs in the card's author field, not in its title.
    */
   private static readonly CRAWLER_UA =
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

   private async fetchLinkedIn(url: string): Promise<LinkMetadata | undefined> {
      let res = await this.request(url, {
         "User-Agent": LinkMetadataFetcher.CRAWLER_UA,
         "Referer": "https://www.google.com/",
      });

      // Should LinkedIn ever stop trusting that UA, the default one still covers every route
      // except /school/.
      if (!res || res.status !== 200) {
         res = await this.request(url, { "Referer": "https://www.google.com/" });
      }
      if (!res || res.status !== 200) return this.buildLinkedInFallback(url);

      const decodedText = await this.decodeHtmlContent(res.arrayBuffer, res.text);

      // Some routes (`/events/<id>` among them) answer 200 with the sign-in page instead of
      // the content, so a card built from it would read "Sign Up | LinkedIn" as if that were
      // the page. The title is localised - it came back in Italian on one run and English on
      // the next - so the reliable tell is that the page declares someone else's address:
      // every real page echoes its own URL in og:url, the wall says /login.
      if (LinkMetadataFetcher.isLinkedInAuthWall(decodedText, url)) {
         console.debug(`LinkedIn served the sign-in page for ${url}.`);
         return this.withParsedFurniture(this.buildLinkedInFallback(url), url, decodedText);
      }

      const metadata = await new LinkMetadataParser(url, decodedText).parse();
      if (!metadata) return this.buildLinkedInFallback(url);

      const { title, author } = this.parseLinkedInTitle(metadata.title, url);
      return {
         ...metadata,
         title,
         author: author ?? metadata.author,
         description: this.trimLinkedInDescription(metadata.description),
         host: "linkedin.com",
         favicon: metadata.favicon ?? "https://www.linkedin.com/favicon.ico",
      };
   }

   /**
    * Every failure above builds from the URL rather than falling back, and that is deliberate.
    *
    * `fetchGeneric` would only repeat the request just made. `fetchFallback` is worse:
    * Microlink renders the page with a headless browser, hits the very same wall, and hands
    * back a confident card built from it - a dead post came out titled "LinkedIn" with the
    * language picker as its description, and the sign-in page came out as "LinkedIn Login,
    * Sign in". `fetchTitleOnly` would re-read that same `<title>`. Reddit is excluded from
    * Microlink for the same reason.
    *
    * A LinkedIn URL carries more than most: /posts/<handle>_<slug>-activity-<id> holds both
    * the author's handle and the words of the post, so a dead post still reads as something
    * a person can recognise instead of as a login form.
    */
   private buildLinkedInFallback(url: string): LinkMetadata {
      const base = { url, host: "linkedin.com", favicon: "https://www.linkedin.com/favicon.ico", indent: 0 };

      let path: string;
      try {
         path = new URL(url).pathname;
      } catch {
         return { ...base, title: "LinkedIn" };
      }

      const post = path.match(/^\/posts\/([^/_]+)_(.+?)-activity-\d+/i);
      if (post) {
         const words = LinkMetadataFetcher.deslug(post[2]);
         return { ...base, title: words ?? "LinkedIn post", author: post[1] };
      }
      if (/^\/feed\/update\//i.test(path)) return { ...base, title: "LinkedIn post" };
      if (/^\/events\//i.test(path)) return { ...base, title: "LinkedIn event" };
      if (/^\/newsletters\//i.test(path)) return { ...base, title: "LinkedIn newsletter" };
      if (/^\/jobs\//i.test(path)) return { ...base, title: "LinkedIn job" };

      // A profile, company or school slug is a name, so each word is capitalised
      // ("stanford-university" -> "Stanford University"); a post slug is a sentence and
      // keeps sentence case.
      const named = path.match(/^\/(?:in|company|school)\/([^/?#]+)/i);
      // A public profile slug ends in a disambiguating token when the name was taken:
      // "mario-rossi-1a2b3c". It always carries a digit, which a name word never does.
      const slug = named?.[1]?.replace(/-[0-9a-z]*\d[0-9a-z]*$/i, "") || named?.[1];
      const name = LinkMetadataFetcher.deslug(slug, "title");
      return { ...base, title: name ?? "LinkedIn" };
   }

   /**
    * Notion.
    *
    * A published page is rendered in the browser, so an anonymous request gets the same
    * client-side shell whatever it asks for: a real page, an invented one and a workspace
    * that never existed all come back 200 with og:title "Notion | Where teams and agents
    * work together" and Notion's own marketing blurb. That is the Thingiverse failure - every
    * card would carry the same confident, wrong text - and it is why the generic path cannot
    * have this domain. It also rules out Microlink as a fallback: a headless browser would
    * render the page properly, but fetchGeneric never reaches it, because parsing the shell
    * *succeeds*.
    *
    * Notion serves the real thing to a crawler UA, checked 2026-09-08 on both URL forms:
    *
    *   - `www.notion.so/<Slug>-<id>` and `<workspace>.notion.site/<Slug>-<id>` return the
    *     page's own og:title, description and image
    *   - a page id that does not exist returns a bare **404**, on either host - proof of
    *     absence, so the card is built from the URL and no Microlink request is spent
    *   - a workspace that does not exist is the one case that still answers 200 with the
    *     shell, so the shell has to be recognised as well as the 404
    *
    * This is UA sniffing, not a documented API - the fragile category, next to LinkedIn and
    * Twitch. What limits the damage is that failure is one-way: if Notion stops trusting the
    * crawler UA, every request becomes a non-200 and every card falls back to the URL, which
    * is worse than today but still honest. It never goes back to serving the marketing blurb.
    */
   private async fetchNotion(url: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(url, {
         "User-Agent": LinkMetadataFetcher.CRAWLER_UA,
      });

      // Anything that is not a readable page ends at the URL, exactly as LinkedIn does, and
      // for the same reason: the two fallbacks both lead back to the shell. Whatever the page
      // did say for itself still rides along - a missing page id answers with nine bytes and
      // has nothing to give, but the shell has its artwork and blurb.
      if (!res) return this.buildNotionFallback(url);
      const decodedText = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      if (res.status !== 200) {
         return this.withParsedFurniture(this.buildNotionFallback(url), url, decodedText);
      }

      if (LinkMetadataFetcher.isNotionShell(decodedText)) {
         console.debug(`Notion served its generic shell for ${url}.`);
         return this.withParsedFurniture(this.buildNotionFallback(url), url, decodedText);
      }

      const metadata = await new LinkMetadataParser(url, decodedText).parse();
      if (!metadata) return this.buildNotionFallback(url);

      return {
         ...metadata,
         title: LinkMetadataFetcher.trimNotionSuffix(metadata.title),
         // Dropped rather than trimmed: what Notion declares is "<workspace> on Notion", and
         // the workspace's own name is not the site's. SITE_NAMES supplies "Notion" once this
         // is empty - see withSiteName.
         siteName: undefined,
      };
   }

   /**
    * The shell declares somebody else's address - og:url is a bare `https://app.notion.com`,
    * where a real page echoes its own `*.notion.site` URL and a marketing page its
    * `notion.com` one. Same tell as isLinkedInAuthWall, and steadier than the title, which is
    * localised and rewritten whenever the marketing does. (The shell's og:image, the
    * `app.notion.com/images/meta/default.png` default, says the same thing.)
    */
   private static isNotionShell(html: string): boolean {
      const declared = html.match(/property="og:url"\s+content="([^"]*)"/i)
         ?? html.match(/content="([^"]*)"\s+property="og:url"/i);
      return /^https?:\/\/app\.notion\.com\/?$/i.test(declared?.[1]?.trim() ?? "");
   }

   /**
    * Every Notion page title ends " | Notion", including the marketing ones. The host is
    * already on the card and SITE_NAMES labels the markdown link, so the suffix is repetition.
    */
   private static trimNotionSuffix(title: string): string {
      return title.replace(/\s*\|\s*Notion\s*$/i, "").trim() || title;
   }

   /**
    * A Notion URL is `<Page-Title>-<32 hex id>`, so the slug is real words and the id is
    * noise. Title case: it is a page name, not a sentence.
    */
   private buildNotionFallback(url: string): LinkMetadata {
      const card = this.buildUrlCard(url);
      // Read the last segment off the parsed pathname, not the raw string: a workspace root
      // has no path at all, and splitting the URL text there hands back the hostname.
      let last: string | undefined;
      try {
         last = new URL(url).pathname.split("/").filter(Boolean).pop();
      } catch {
         return card;
      }
      const id = "[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
      const slug = last?.replace(new RegExp(`-?(?:${id})$`, "i"), "");
      const title = LinkMetadataFetcher.deslug(slug, "title");
      if (title) return { ...card, title };

      // The URL was nothing but the id (`notion.so/83715d77...`). buildUrlCard would read the
      // id itself as the title, and a page named "83715d77…" tells a reader nothing.
      return { ...card, title: (card.host && LinkMetadataFetcher.siteNameFor(card.host)) || card.title };
   }

   /**
    * Discord.
    *
    * Two forms of Discord link, and both fail on the generic path the way Notion does -
    * not by being unreadable, but by reading as something else. An invite that has expired,
    * been revoked or never existed answers **200** with Discord's front-page shell
    * ("Discord - Group Chat That's All Fun & Games"), and so does every
    * `discord.com/channels/…` link, which is a pointer into a server nobody can open without
    * being a member. Left generic, those become confident cards advertising Discord.
    *
    * The page itself says everything else, so there is no API call (reworked 2026-09-11
    * against the field rules - it used to go through `discord.com/api/v10/invites/`). A live
    * invite page declares "Join the <name> Discord Server!" as `og:title` (the bare name as
    * its `<title>`), the server's description plus " | <n> members" as
    * `og:description`, the splash as `og:image`, and echoes its own `/invite/<code>` address
    * as `og:url`. The shell declares no `og:url` at all - that is the tell, the one LinkedIn
    * and Notion use too - so a dead invite needs no endpoint to be recognised, and its card
    * (title from the URL, the shell's furniture) is the same either way. One request, live or
    * dead. Checked on ten live servers and two dead invites.
    */
   private static readonly discordCache = new Map<string, LinkMetadata>();

   private async fetchDiscord(url: string): Promise<LinkMetadata | undefined> {
      const code = url.match(/^https?:\/\/(?:www\.)?(?:discord\.gg|(?:discord|discordapp)\.com\/invite)\/([^/?#]+)/i)?.[1];
      // A /channels/ link is private by definition: reading it would need a bot token in that
      // very server, so there is nothing to request and the card is named from the URL shape.
      if (!code) return this.discordChannelCard(url);

      const cached = LinkMetadataFetcher.discordCache.get(code.toLowerCase());
      if (cached) return { ...cached, url };

      const res = await this.request(url);
      // No page at all - a 5xx, a dead network. Nothing to read and nothing proven, but the
      // generic path would only reach the same shell, so the card is built from the URL.
      if (!res || res.status !== 200) return this.discordInviteFallback(url, code);

      const html = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      // Parsed against the page's canonical address, not the pasted one: the favicon is
      // declared as a relative `/assets/favicon.ico`, which on `discord.gg` resolves to the
      // SPA's HTML rather than an icon.
      const parser = new LinkMetadataParser(`https://discord.com/invite/${code}`, html);
      const parsed = await parser.parse();
      const declaredUrl = parser.htmlDoc.querySelector("meta[property='og:url']")?.getAttribute("content") ?? "";
      if (!parsed || !/\/invite\//i.test(declaredUrl)) {
         console.debug(`Discord answered ${url} with its front-page shell; building from the URL.`);
         return this.discordInviteFallback(url, code, html);
      }

      const card = this.discordInviteCard(url, parsed);
      LinkMetadataFetcher.discordCache.set(code.toLowerCase(), card);
      return card;
   }

   /**
    * A live invite, from its own page. The title is the page's `og:title` as declared -
    * "Join the Python Discord Server!", which says what the link is: an invitation. Turning
    * it into the bare name the `<title>` carries was tried and rejected on 2026-09-11: no
    * field-rule operation covers it (B6 drops a site-name segment, and this is a phrase
    * wrapped around the name), so it would have been a rule written for one site. The
    * " | <n> members" segment Discord appends to the server's description is dropped, an
    * audience metric (rule C4). A server with no description of its own gets Discord's stock
    * sentence instead ("Check out the <name> community on Discord - hang out with <n> other
    * members…"): the count is inside a sentence there, not a segment, so that text is kept
    * verbatim rather than rewritten.
    */
   private discordInviteCard(url: string, parsed: LinkMetadata): LinkMetadata {
      const description = parsed.description?.replace(/\s*\|\s*\d[\d.,\s]*members?$/i, "").trim() || parsed.description;
      return {
         ...parsed,
         url,
         description,
         // discord.com on both hosts, matching the og:url the page declares - discord.gg is
         // Discord's own shortener, not a separate site.
         host: "discord.com",
         favicon: parsed.favicon || LinkMetadataFetcher.DISCORD_FAVICON,
      };
   }

   /**
    * `discord.com/favicon.ico` is a 404 and `discord.gg/favicon.ico` answers with the SPA's
    * HTML, so the guess buildUrlCard makes is wrong on both hosts. The page declares the real
    * one; this is only for a card built without a page to read (field rule G2).
    */
   private static readonly DISCORD_FAVICON = "https://discord.com/assets/favicon.ico";

   /**
    * A dead invite. A vanity code is words a server chose for itself and reads as a name
    * ("discord-developers"); a generated one is seven random characters and reads as nothing,
    * so that case says only what the link is. The shell's own furniture rides along when the
    * page was read (rule C5); without a page the bare card stands.
    */
   private async discordInviteFallback(url: string, code: string, html?: string): Promise<LinkMetadata> {
      const vanity = code.includes("-") ? LinkMetadataFetcher.deslug(code, "title") : undefined;
      const card: LinkMetadata = {
         url,
         title: vanity ?? "Discord invite",
         host: "discord.com",
         favicon: LinkMetadataFetcher.DISCORD_FAVICON,
         indent: 0,
      };
      // Parsed against discord.com for the same reason as a live page: the shell's favicon is
      // relative too, and on discord.gg it would resolve to something that is not an icon.
      return html ? this.withParsedFurniture(card, `https://discord.com/invite/${code}`, html) : card;
   }

   /**
    * `/channels/<guild>/<channel>/<message>`, one segment shorter for a channel and shorter
    * again for a server. `@me` in the guild slot is a direct message. All of them are ids, so
    * there is nothing to name the card after but the shape of the link itself.
    */
   private discordChannelCard(url: string): Promise<LinkMetadata> {
      const segments = url.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0]!.split("/").filter(Boolean);
      const depth = segments.length - 1;
      const title = depth >= 3 ? "Discord message" : depth === 2 ? "Discord channel" : "Discord server";
      return this.withDiscordShellFurniture(url, {
         url,
         title,
         host: "discord.com",
         favicon: LinkMetadataFetcher.DISCORD_FAVICON,
         indent: 0,
      });
   }

   /**
    * What is wrong with the shell is its **title**, which presents Discord's front page as if
    * it were the link. Its description and artwork are not wrong in the same way - they are
    * the site's own furniture on a page we have established we cannot read, which is exactly
    * the case `errorPageCard` covers, and Roberto's call (2026-09-03) is that a card carrying
    * the site's graphic reads better than a bare one. The first version of this fetcher threw
    * that away and produced a two-line card; he asked for the furniture back on 2026-09-08.
    *
    * One request, the same one the generic path used to make, and never Microlink. If it
    * fails there is simply no furniture to add and the bare card stands.
    */
   private async withDiscordShellFurniture(url: string, card: LinkMetadata): Promise<LinkMetadata> {
      const res = await this.request(url);
      if (!res || res.status !== 200) return card;
      const html = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      return this.withParsedFurniture(card, url, html);
   }

   private static deslug(segment?: string, casing: "sentence" | "title" = "sentence"): string | undefined {
      if (!segment) return undefined;
      let words: string;
      try {
         words = decodeURIComponent(segment);
      } catch {
         words = segment;
      }
      words = words.replace(/[_+-]+/g, " ").replace(/\s+/g, " ").trim();
      if (!/\p{L}/u.test(words)) return undefined;
      if (casing === "title") {
         return words.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
      }
      return words.charAt(0).toUpperCase() + words.slice(1);
   }

   private static isLinkedInAuthWall(html: string, url: string): boolean {
      const declared = (html.match(/property="og:url"\s+content="([^"]*)"/i)
         ?? html.match(/content="([^"]*)"\s+property="og:url"/i))?.[1]?.trim() ?? "";
      if (/linkedin\.com\/(login|signup|uas\/login|authwall)/i.test(declared)) return true;

      // The **sign-up** page - the one a dead post actually lands on - declares the bare
      // homepage as its address rather than /signup, so it walked straight past the check
      // above and was parsed as if it were the post: a card titled “Iscriviti” carrying
      // LinkedIn's own sign-up blurb, which is the exact card this guard exists to prevent
      // (found 2026-09-08). A real page always echoes its own address, so the homepage is
      // only ever the truth for the homepage itself.
      return /^https?:\/\/(www\.)?linkedin\.com\/?$/i.test(declared)
         && !LinkMetadataFetcher.isLinkedInHome(url);
   }

   private static isLinkedInHome(url: string): boolean {
      try {
         return new URL(url).pathname.replace(/\/+$/, "") === "";
      } catch {
         return false;
      }
   }

   private parseLinkedInTitle(title: string, url: string): { title: string; author?: string; } {
      const stripped = title
         .replace(/\s*\|\s*\d[\d.,\s]*comments?\s*$/i, "")
         .replace(/\s*\|\s*LinkedIn\s*$/i, "")
         .trim();
      if (!stripped) return { title };

      // Only a post puts the author in the title. On a profile or a company page the whole
      // remainder is the name, and a "|" inside it (a tagline, say) is part of it.
      if (!/linkedin\.com\/(posts|feed\/update)\//i.test(url)) return { title: stripped };

      const split = stripped.lastIndexOf("|");
      if (split < 0) return { title: stripped };
      const head = stripped.slice(0, split).trim();
      const author = stripped.slice(split + 1).trim();
      return head && author ? { title: head, author } : { title: stripped };
   }

   private trimLinkedInDescription(description?: string): string | undefined {
      // The same furniture as the title, in its og:description form: "... | 365 comments on
      // LinkedIn". A description long enough to be truncated has already lost it.
      const trimmed = description
         ?.replace(/\s*\|\s*\d[\d.,\s]*comments?\s+on\s+LinkedIn\s*$/i, "")
         .trim();
      return trimmed || undefined;
   }

   /**
    * The last resort: a card built from the URL alone, with no further request.
    *
    * Reached when the page is known not to be readable - a 404, an auth wall - rather than
    * merely hard to read. Two things follow from that. It must not spend a Microlink request:
    * a headless browser renders the same 404 the plain one got, and the quota is as low as
    * 25/day. And it must not read the page's own words either, because on a dead page those
    * describe the error, not the content ("LinkedIn Login, Sign in", "- YouTube").
    *
    * What is left is the URL, which the reader chose to paste and can still recognise. A
    * title is taken from the last path segment that carries letters; a bare id is skipped,
    * since "763622" tells a reader nothing (the Thingiverse lesson). Sites whose URLs have a
    * known shape refine this - see buildLinkedInFallback, buildXFallback, buildImdbFallback.
    */
   private buildUrlCard(url: string): LinkMetadata {
      let parsed: URL;
      try {
         parsed = new URL(url);
      } catch {
         return { url, title: url, host: "", indent: 0 };
      }
      const host = parsed.hostname.replace(/^www\./i, "");
      return {
         url,
         title: LinkMetadataFetcher.titleFromUrlPath(parsed)
            ?? LinkMetadataFetcher.siteNameFor(host)
            ?? host,
         host,
         favicon: `https://${parsed.hostname}/favicon.ico`,
         indent: 0,
      };
   }

   private static titleFromUrlPath(parsed: URL): string | undefined {
      const segments = parsed.pathname.split("/").filter(Boolean);
      // Last segment first, skipping any that carries no letters: an id, a date, a page
      // number. "763622" tells a reader nothing. Apple's own convention - podcasts, apps -
      // adds a trailing `id<digits>` segment that technically has letters (the "id") but
      // means no more than a bare number would ("Id9999999999", found on a dead Apple
      // Podcasts link 2026-09-10); skipped the same way so the real slug before it wins.
      for (let i = segments.length - 1; i >= 0; i--) {
         const raw = segments[i]!.replace(/\.\w{2,5}$/, "");
         if (/^id\d+$/i.test(raw)) continue;
         const words = LinkMetadataFetcher.deslug(raw);
         if (words) return words;
      }
      return undefined;
   }

   private async request(
      url: string, customHeaders: Record<string, string | undefined> = {}, timeoutMs = 5000
   ) {
      const merged: Record<string, string | undefined> = {
         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
         "Accept-Language": this.acceptLanguage(),
         "Cache-Control": "no-cache",
         "Pragma": "no-cache",
         ...customHeaders
      };
      const headers = Object.fromEntries(
         Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined)
      );

      try {
         // `throw: false` matters: without it requestUrl rejects on every non-2xx, this catch
         // swallows the response, and callers see `undefined` with no status at all - so a
         // 404 and a dead network looked identical, and every `res.status !== 200` test below
         // was in practice only ever testing `!res`.
         return await Promise.race([
            requestUrl({ url, headers, throw: false }),
            new Promise<never>((_, reject) =>
               window.setTimeout(() => reject(new Error("Timeout")), timeoutMs)
            ),
         ]);
      } catch (e) {
         console.error(`Fetch failed for ${url}:`, e);
         return undefined;
      }
   }
}