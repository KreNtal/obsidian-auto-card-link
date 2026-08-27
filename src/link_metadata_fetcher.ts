import { Notice, requestUrl } from "obsidian";
import {
   DailymotionVideoResponse, GitHubRepoResponse, ImdbSuggestionResponse, LinkMetadata, MicrolinkResponse, OEmbedResponse,
   PrintablesGraphQLResponse, WikipediaSummaryResponse
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

   async fetch(url: string, options?: { refresh?: boolean; }): Promise<LinkMetadata | undefined> {
      url = url.trim().replace(/^["']|["']$/g, "");
      if (url.startsWith("http://")) url = "https://" + url.slice(7);
      url = this.stripCloudflareChallenge(url);

      const metadata = await this.fetchForUrl(url, options?.refresh ?? false);
      return metadata ? this.withSiteName(metadata, url) : metadata;
   }

   private async fetchForUrl(url: string, refresh: boolean): Promise<LinkMetadata | undefined> {
      if (CheckIf.isYouTubeUrl(url)) return this.fetchYouTube(url);
      if (CheckIf.isVimeoUrl(url)) return this.fetchVimeo(url);
      if (CheckIf.isDailymotionUrl(url)) return this.fetchDailymotion(url);
      if (CheckIf.isTwitchUrl(url)) return this.fetchTwitch(url);
      if (CheckIf.isTedUrl(url)) return this.fetchTed(url);
      if (CheckIf.isRedditUrl(url)) return this.fetchReddit(url, refresh);
      if (CheckIf.isImdbUrl(url)) return this.fetchImdb(url);
      if (CheckIf.isPrintablesUrl(url)) return this.fetchPrintables(url);
      if (CheckIf.isGitHubUrl(url)) return this.fetchGitHub(url);
      if (CheckIf.isSpotifyUrl(url)) return this.fetchSpotify(url);
      if (CheckIf.isWikipediaUrl(url)) return this.fetchWikipedia(url);

      return this.fetchGeneric(url);
   }

   /**
    * Display names for the sites we handle with a dedicated fetcher. Those paths answer
    * from an API or oEmbed and never look at the page HTML, so there is no og:site_name
    * to read; deriving a name from the hostname instead would get the capitalisation
    * wrong ("Youtube", "Imdb", "Github").
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
      "spotify.com": "Spotify",
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
      return CheckIf.isTwitchUrl(url) || CheckIf.isSpotifyUrl(url);
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
   // `isUnusable` lets a caller reject metadata that parsed fine but isn't real content
   // (e.g. Reddit's login-wall shell). It has to be checked in here rather than by the
   // caller: this method already falls back to the external service on failure, so a caller
   // that inspected the result and then called fetchFallback itself would run that — and
   // burn Microlink's small daily quota — twice for the same card.
   private async fetchGeneric(
      url: string,
      isUnusable?: (metadata: LinkMetadata) => boolean
   ): Promise<LinkMetadata | undefined> {
      const res = await this.request(url, {
         "Referer": "https://www.google.com/"
      });

      if (!res || res.status !== 200) {
         console.debug(`Fetch failed for ${url}. Status: ${res?.status}`);
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
      if (metadata && this.looksLikeUrlSlugTitle(metadata.title, url)) {
         console.debug(`Fetch for ${url} returned only a URL-slug placeholder title.`);
         return this.fetchFallback(url);
      }

      if (metadata && isUnusable?.(metadata)) {
         console.debug(`Fetch for ${url} returned a placeholder page rather than real content.`);
         return this.fetchFallback(url);
      }

      return metadata ?? this.fetchFallback(url);
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
         const result = await this.fetchViaMicrolink(url);
         // Microlink can hit the same anti-bot placeholder shell we do — its headless
         // browser isn't a guaranteed bypass — so the result needs the same sanity check
         // as the direct fetch above, not a blind accept just because the call succeeded.
         // No retry-with-force-refresh here: it doubles the cost against Microlink's tight
         // daily quota (as low as 25/day) for a bypass that isn't reliable anyway — a stale
         // cached placeholder and a freshly-blocked render look identical from here.
         if (result.metadata) {
            if (!this.looksLikeUrlSlugTitle(result.metadata.title, url)) return result.metadata;
            console.debug(`Microlink result for ${url} looked like a placeholder title:`, result.metadata.title);
         }
         if (result.rateLimited) {
            new Notice("Daily limit for the external metadata service (microlink.io) reached. Showing a basic card — try again tomorrow.");
            return this.fetchTitleOnly(url);
         }
      }
      new Notice(`Couldn't fetch metadata for ${new URL(url).hostname}`);
      return this.fetchTitleOnly(url);
   }

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

      // Even on non-200, some sites return HTML in the body (e.g. 202, 403 with a page)
      // so we attempt to parse the title regardless of status
      if (res?.text) {
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

      // Nothing worked — return a minimal card with just the hostname as title
      return {
         url,
         title: hostname,
         host: hostname,
         favicon: `https://${hostname}/favicon.ico`,
         indent: 0,
      };
   }

   /* --- YOUTUBE --- */
   private async fetchYouTube(url: string): Promise<LinkMetadata | undefined> {
      // Channels: oEmbed doesn't support them, scrape the page directly
      if (/youtube\.com\/(@|c\/|channel\/)/.test(url)) {
         const res = await this.request(url, { "Accept-Language": "en-US,en;q=0.9" });
         if (!res || res.status !== 200) return this.fetchGeneric(url);
         const metadata = await new LinkMetadataParser(url, res.text).parse();
         if (!metadata) return this.fetchGeneric(url);
         return { ...metadata, author: metadata.title ?? undefined, host: "www.youtube.com", favicon: "https://www.youtube.com/favicon.ico" };
      }

      // Videos and playlists: both supported by oEmbed
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await this.request(oembedUrl);
      if (!res || res.status !== 200) return;

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
         host: "www.youtube.com",
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
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      const data = JSON.parse(res.text) as OEmbedResponse;
      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: data.author_name ?? undefined,
         description: data.description
            ? LinkMetadataParser.sanitizeText(data.description.slice(0, 200))
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
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      const data = JSON.parse(res.text) as DailymotionVideoResponse;
      const author = data["owner.screenname"];
      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: author ?? undefined,
         description: data.description
            ? LinkMetadataParser.sanitizeText(data.description.slice(0, 200))
            : undefined,
         host: "www.dailymotion.com",
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

   private async fetchTwitch(url: string): Promise<LinkMetadata | undefined> {
      // Twitch serves og: meta tags server-side, but sometimes returns the SPA shell
      // (bot detection or CDN miss). Retry up to 3 times with increasing delays and
      // rotated user agents to improve the hit rate.
      const retryDelays = [0, 1500, 3000];

      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
         if (attempt > 0) await new Promise(r => window.setTimeout(r, retryDelays[attempt]));

         const ua = this.twitchUserAgents[attempt % this.twitchUserAgents.length]!;
         const res = await this.request(url, {
            "User-Agent": ua,
            "Referer": "https://www.google.com/",
            "Accept-Language": "en-US,en;q=0.9",
         }, 9000);

         if (!res || res.status !== 200) continue;
         if (!this.isTwitchResponseUsable(res.text)) continue;

         const parser = new LinkMetadataParser(url, res.text);
         const metadata = await parser.parse();
         if (!metadata) continue;

         const duration = this.extractTwitchDuration(res.text);
         const isClip = /\/clip\//.test(url) || url.includes("clips.twitch.tv");
         const isVod = /\/videos\//.test(url);
         const host = url.includes("clips.twitch.tv") ? "clips.twitch.tv" : "www.twitch.tv";

         if (isVod) {
            // "VideoTitle - ChannelName on Twitch"
            const { title, author: titleAuthor } = this.parseTwitchTitle(metadata.title);
            const author = this.extractTwitchChannel(url) ?? titleAuthor;
            const linkTitle = author && title ? `${title} - ${author}` : title;
            return { ...metadata, title, author, host, favicon: "https://www.twitch.tv/favicon.ico", duration, linkTitle };
         }

         if (isClip) {
            // Same shape as a VOD: "ClipTitle - ChannelName on Twitch". (Twitch used to put
            // the channel first here; the code kept assuming that long after it stopped being
            // true, which swapped the title and the author of every clip.)
            const { title: parsedTitle, author: titleAuthor } = this.parseTwitchTitle(metadata.title);
            const author = titleAuthor ?? this.extractTwitchChannel(url);

            let title = parsedTitle;
            if (!title || title === author) {
               // og:title carried only the channel: the clip name is in og:description, as
               // Watch <channel>'s clip titled "<name>". The quotes reach us escaped for the
               // card's YAML, hence the optional backslash.
               const m = metadata.description?.match(/clip titled\s+\\?"([^"\\]+)/i);
               title = m?.[1]?.trim() || parsedTitle;
            }

            const description = author ? `Watch a ${author} clip on Twitch` : undefined;
            const linkTitle = author && title ? `${title} - ${author}` : title;
            return { ...metadata, title, author, description, host, favicon: "https://www.twitch.tv/favicon.ico", duration, linkTitle };
         }

         // Live: og:title = "ChannelName - Twitch", og:description = stream title
         const author = metadata.title?.replace(/\s*-\s*Twitch\s*$/i, "").trim() || undefined;
         const title = metadata.description ?? metadata.title ?? "";
         const description = author ? `Watch ${author} live on Twitch` : undefined;
         return { ...metadata, title, author, description, host, favicon: "https://www.twitch.tv/favicon.ico", duration: "Live", linkTitle: author };
      }

      // All attempts returned the SPA shell — fall back to generic
      return this.fetchGeneric(url);
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

   private parseTwitchTitle(raw: string): { title: string; author: string | undefined; } {
      // Twitch titles follow "VideoTitle - ChannelName on Twitch"
      const withoutSuffix = raw.replace(/\s+on\s+Twitch\s*$/i, "").trim();
      const lastDash = withoutSuffix.lastIndexOf(" - ");
      if (lastDash >= 0) {
         return {
            title: withoutSuffix.slice(0, lastDash).trim(),
            author: withoutSuffix.slice(lastDash + 3).trim() || undefined,
         };
      }
      return { title: withoutSuffix, author: undefined };
   }

   private extractTwitchDuration(html: string): string | undefined {
      const secMatch = html.match(/"durationSeconds"\s*:\s*(\d+)/);
      if (secMatch) return this.formatDuration(parseInt(secMatch[1]!, 10));

      const ogMatch = html.match(/property="og:video:duration"\s+content="(\d+)"/);
      if (ogMatch) return this.formatDuration(parseInt(ogMatch[1]!, 10));

      return undefined;
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
         host: "www.ted.com",
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

      // Both endpoints only handle individual posts — oEmbed answers 400 for a subreddit or
      // profile URL — so don't spend a request finding that out.
      if (isPost) {
         const oembed = await this.fetchRedditOembed(url);
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
      const metadata = await this.fetchGeneric(url, m => this.isGenericRedditPage(m.title, m.description));

      // That chain ends in fetchTitleOnly, which reads the page <title> without any such
      // guard — so a blocked subreddit/profile still comes back titled just "Reddit". The
      // name in the URL is both accurate and more useful than that, so prefer it.
      if (metadata && this.isGenericRedditPage(metadata.title)) {
         const name = this.redditNameFromUrl(url);
         if (name) return { ...metadata, title: name, host: "www.reddit.com" };
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
      const res = await this.request(feedUrl, { "Accept": "application/atom+xml, application/xml" });
      this.rememberRedditFeedBudget(res?.headers);

      // 429 included: being throttled is not worth a notice, the chain below still has a name
      if (!res || res.status !== 200 || !res.text) return undefined;

      const head = res.text.split("<entry")[0] ?? "";
      const title = this.decodeXmlText(head.match(/<title[^>]*>([^<]+)<\/title>/)?.[1]);
      const subtitle = this.decodeXmlText(head.match(/<subtitle[^>]*>([^<]+)<\/subtitle>/)?.[1]);
      if (!title) return undefined;

      // Reddit suffixes both with the subreddit, in its own two formats
      const cleanTitle = isPost
        ? title.replace(new RegExp(`\\s*:\\s*${name.slice(2)}$`, "i"), "").trim()
        : `${title} • ${name}`;

      const metadata: LinkMetadata = {
         url,
         title: LinkMetadataParser.sanitizeText(cleanTitle, 300) ?? cleanTitle,
         // A post's <subtitle> is the subreddit's own description, not the post's - using it
         // here would describe the wrong thing. The post's actual self-text instead sits
         // inside its entry's <content>, extracted separately below.
         description: isPost ? this.extractRedditFeedEntryBody(res.text) : LinkMetadataParser.sanitizeText(subtitle),
         host: "www.reddit.com",
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
         return text ? LinkMetadataParser.sanitizeText(text, 200) : undefined;
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

   private async fetchRedditOembed(originalUrl: string): Promise<LinkMetadata | undefined> {
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
         const description = embed?.description ?? (await this.fetchRedditFeed(originalUrl, true, false, true))?.description;
         return {
            url: originalUrl,
            title: LinkMetadataParser.sanitizeText(json.title) ?? json.title,
            author: subreddit
               ? `r/${subreddit}`
               : json.author_name ? `u/${json.author_name}` : undefined,
            description,
            host: "www.reddit.com",
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

         const res = await this.request(embedUrl);
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
         return text ? LinkMetadataParser.sanitizeText(text, 200) : undefined;
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
               ? LinkMetadataParser.sanitizeText(rawDesc.slice(0, 200))
               : undefined,
            host: "www.printables.com",
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
            host: "www.printables.com",
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
         host: "www.printables.com",
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
         host: "www.imdb.com",
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
         host: "www.imdb.com",
         favicon: "https://www.imdb.com/favicon.ico",
         indent: 0,
      };
   }

   /* --- GITHUB --- */
   private async fetchGitHub(url: string): Promise<LinkMetadata | undefined> {
      const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
      if (!m) return this.fetchGeneric(url);
      const [, owner, repo] = m;

      const [apiRes, htmlRes] = await Promise.all([
         this.request(`https://api.github.com/repos/${owner}/${repo}`, {
            "Accept": "application/vnd.github+json",
         }),
         this.request(`https://github.com/${owner}/${repo}`, {
            "Referer": "https://www.google.com/",
         }),
      ]);

      if (!apiRes || apiRes.status !== 200) return this.fetchGeneric(url);

      const data = JSON.parse(apiRes.text) as GitHubRepoResponse;
      const stars: number = data.stargazers_count ?? 0;
      const starsLabel = stars >= 1000
         ? `${(stars / 1000).toFixed(1)}k`
         : String(stars);

      const descParts: string[] = [];
      if (data.description) descParts.push(data.description);
      if (data.language) descParts.push(data.language);
      descParts.push(`★ ${starsLabel}`);

      // Use LinkMetadataParser for og:image extraction — more robust than a regex
      let ogImage: string | undefined;
      if (htmlRes?.text) {
         const htmlMeta = await new LinkMetadataParser(url, htmlRes.text).parse();
         ogImage = htmlMeta?.image;
      }

      return {
         url,
         title: data.full_name ?? `${owner}/${repo}`,
         author: owner,
         description: descParts.join(" · "),
         host: "github.com",
         favicon: "https://github.com/favicon.ico",
         image: ogImage,
         indent: 0,
      };
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

   private async request(url: string, customHeaders: Record<string, string> = {}, timeoutMs = 5000) {
      const headers = {
         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
         "Accept-Language": this.acceptLanguage(),
         "Cache-Control": "no-cache",
         "Pragma": "no-cache",
         ...customHeaders
      };

      try {
         return await Promise.race([
            requestUrl({ url, headers }),
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