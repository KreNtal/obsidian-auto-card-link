import { Notice, requestUrl } from "obsidian";
import { LinkMetadata } from "./interfaces";
import { LinkMetadataParser } from "./link_metadata_parser";
import { CheckIf } from "./checkif";

export class LinkMetadataFetcher {

   async fetch(url: string): Promise<LinkMetadata | undefined> {
      url = url.trim().replace(/^["']|["']$/g, "");
      if (url.startsWith("http://")) url = "https://" + url.slice(7);
      if (CheckIf.isYouTubeUrl(url)) return this.fetchYouTube(url);
      if (CheckIf.isVimeoUrl(url)) return this.fetchVimeo(url);
      if (CheckIf.isDailymotionUrl(url)) return this.fetchDailymotion(url);
      if (CheckIf.isTwitchUrl(url)) return this.fetchTwitch(url);
      if (CheckIf.isTedUrl(url)) return this.fetchTed(url);
      if (CheckIf.isRedditUrl(url)) return this.fetchReddit(url);
      if (CheckIf.isImdbUrl(url)) return this.fetchImdb(url);
      if (CheckIf.isGitHubUrl(url)) return this.fetchGitHub(url);
      if (CheckIf.isSpotifyUrl(url)) return this.fetchSpotify(url);
      if (CheckIf.isWikipediaUrl(url)) return this.fetchWikipedia(url);

      return this.fetchGeneric(url);
   }

   /* --- GENERIC --- */
   private async fetchGeneric(url: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(url, {
         "Referer": "https://www.google.com/"
      });

      if (!res || res.status !== 200) {
         console.log(`Fetch failed for ${url}. Status: ${res?.status}`);
         new Notice(`Couldn't fetch metadata for ${new URL(url).hostname}`);
         return this.fetchTitleOnly(url);
      }

      const decodedText = await this.decodeHtmlContent(res.arrayBuffer, res.text);
      const parser = new LinkMetadataParser(url, decodedText);
      return parser.parse() ?? this.fetchTitleOnly(url);
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
               title: LinkMetadataParser.sanitizeText(title) ?? title,
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
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await this.request(oembedUrl);
      if (!res || res.status !== 200) return;

      const data = JSON.parse(res.text);
      const videoId = this.getYouTubeVideoId(url);

      const image = videoId
         ? await this.getBestYouTubeThumbnail(videoId)
         : data.thumbnail_url;

      const { description, duration } = await this.getYouTubePageData(url, data.author_name);

      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: data.author_name ?? undefined,
         author: data.author_name ?? undefined,
         description: LinkMetadataParser.sanitizeText(description),
         host: "www.youtube.com",
         favicon: "https://www.youtube.com/favicon.ico",
         image,
         duration,
         indent: 0,
      };
   }

   private getYouTubeVideoId(url: string): string | undefined {
      return url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
      return url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
   }

   private async getYouTubePageData(
      url: string,
      authorName: string
   ): Promise<{ description: string | undefined; duration?: string; }> {
      const fallback = { description: undefined as string | undefined };
   ): Promise < { description: string | undefined; duration?: string; } > {
         const fallback = { description: undefined as string | undefined };

         const res = await this.request(url, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
         });

         if(!res || res.status !== 200) return fallback;

      // Extract shortDescription
      let description = fallback.description;
      const descMatch = res.text.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (descMatch) {
         try {
            const raw = JSON.parse(`"${descMatch[1]}"`).trim();
            if (raw) description = raw.length > 160 ? raw.slice(0, 160) + "..." : raw;
         } catch { /* keep fallback */ }
      }

      // Extract duration from lengthSeconds
      let duration: string | undefined;
      const lengthMatch = res.text.match(/"lengthSeconds":"(\d+)"/);
      if (lengthMatch) duration = this.formatDuration(parseInt(lengthMatch[1]!, 10));

      return { description, duration };
   }

   private async getBestYouTubeThumbnail(videoId: string): Promise<string> {
      for (const q of ["maxresdefault", "sddefault", "hqdefault"]) {
         const thumbUrl = `https://i.ytimg.com/vi/${videoId}/${q}.jpg`;
         const res = await this.request(thumbUrl);
         if (res && res.status === 200) return thumbUrl;
      }
      return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
   }

   /* --- VIMEO --- */
   private async fetchVimeo(url: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(
         `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      );
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      const data = JSON.parse(res.text);
      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: data.author_name ?? undefined,
         author: data.author_name ?? undefined,
         description: data.description
            ? LinkMetadataParser.sanitizeText(data.description.slice(0, 200))
            : undefined,
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

      const data = JSON.parse(res.text);
      const author = data["owner.screenname"];
      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         author: author ?? undefined,
         author: author ?? undefined,
         description: data.description
            ? LinkMetadataParser.sanitizeText(data.description.slice(0, 200))
            : undefined,
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
         if (attempt > 0) await new Promise(r => setTimeout(r, retryDelays[attempt]));

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
            return { ...metadata, title, author, host, favicon: "https://www.twitch.tv/favicon.ico", duration };
         }

         if (isClip) {
            // Clips follow "ChannelName - ClipTitle on Twitch" (author first, opposite of VODs)
            const withoutSuffix = metadata.title.replace(/\s+on\s+Twitch\s*$/i, "").trim();
            const firstDash = withoutSuffix.indexOf(" - ");
            let title: string;
            let author: string | undefined;
            if (firstDash >= 0) {
               author = withoutSuffix.slice(0, firstDash).trim() || undefined;
               title = withoutSuffix.slice(firstDash + 3).trim();
            } else {
               // Fallback: og:title = "ChannelName", og:description = "Watch X clip titled \"Title\""
               author = metadata.title?.trim() || undefined;
               const m = metadata.description?.match(/clip titled\s+"([^"]+)"/i);
               title = m?.[1] ?? metadata.title ?? "";
            }
            const description = author ? `Watch a ${author} clip on Twitch` : undefined;
            return { ...metadata, title, author, description, host, favicon: "https://www.twitch.tv/favicon.ico", duration };
         }

         // Live: og:title = "ChannelName - Twitch", og:description = stream title
         const author = metadata.title?.replace(/\s*-\s*Twitch\s*$/i, "").trim() || undefined;
         const title = metadata.description ?? metadata.title ?? "";
         const description = author ? `Watch ${author} live on Twitch` : undefined;
         return { ...metadata, title, author, description, host, favicon: "https://www.twitch.tv/favicon.ico", duration };
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
   private async fetchReddit(url: string): Promise<LinkMetadata | undefined> {
      const normalized = url
         .replace("old.reddit.com", "www.reddit.com")
         .replace(/\?.*$/, "")
         .replace(/\?.*$/, "")
         .replace(/\/?$/, "/");

      if (/reddit\.com\/r\/\w+\/comments\//.test(normalized))
         return this.fetchRedditPost(url, normalized);
      if (/reddit\.com\/r\/\w+\/?$/.test(normalized))
         return this.fetchRedditSubreddit(url, normalized);
      if (/reddit\.com\/(?:u|user)\/\w+/.test(normalized))
         return this.fetchRedditUser(url, normalized);

      return undefined;
   }

   private async fetchRedditPost(originalUrl: string, normalized: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(normalized.replace(/\/?$/, ".json") + "?limit=1");
      if (!res || res.status !== 200) return;

      const post = JSON.parse(res.text)[0]?.data?.children?.[0]?.data;
      if (!post) return;

      return {
         url: originalUrl,
         title: LinkMetadataParser.sanitizeText(post.title) ?? post.title,
         author: post.subreddit ? `r/${post.subreddit}` : undefined,
         description: LinkMetadataParser.sanitizeText(
            post.selftext
               ? post.selftext.slice(0, 200).replace(/\n/g, " ") + "…"
               : post.author ? `u/${post.author}` : undefined
         ),
         host: "www.reddit.com",
         favicon: "https://www.reddit.com/favicon.ico",
         image: this.getRedditPostImage(post),
         indent: 0,
      };
   }

   private getRedditPostImage(post: any): string | undefined {
      // 1. Direct image post — post.url is the full-res image (i.redd.it)
      if (
         post.post_hint === "image" &&
         post.url &&
         /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(post.url)
      ) {
         return post.url;
      }

      // 2. Gallery post — grab the first image from media_metadata
      if (post.is_gallery && post.media_metadata && post.gallery_data?.items?.length) {
         const firstId = post.gallery_data.items[0]?.media_id;
         if (firstId) {
            const meta = post.media_metadata[firstId];
            const url = meta?.s?.u?.replace(/&amp;/g, "&");
            if (url) return url;
         }
      }

      // 3. Preview image — works for link posts and crossposts
      const previewUrl = post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&");
      if (previewUrl) return previewUrl;

      // 4. Fallback: any URL ending in an image extension
      if (post.url && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(post.url)) {
         return post.url;
      }

      return undefined;
   }

   private async fetchRedditSubreddit(originalUrl: string, normalized: string): Promise<LinkMetadata | undefined> {
      const res = await this.request(normalized.replace(/\/?$/, "/about.json"));
      if (!res || res.status !== 200) return;

      const sub = JSON.parse(res.text)?.data;
      if (!sub) return;

      const rawIcon = sub.community_icon || sub.icon_img || "";
      return {
         url: originalUrl,
         title: `r/${sub.display_name}`,
         description: sub.public_description?.trim() || undefined,
         host: "www.reddit.com",
         favicon: "https://www.reddit.com/favicon.ico",
         image: rawIcon.split("?")[0] || undefined,
         indent: 0,
      };
   }

   private async fetchRedditUser(originalUrl: string, normalized: string): Promise<LinkMetadata | undefined> {
      const username = normalized.match(/reddit\.com\/(?:u|user)\/(\w+)/)?.[1];
      if (!username) return;

      const res = await this.request(`https://www.reddit.com/user/${username}/about.json`);
      if (!res || res.status !== 200) return;

      const user = JSON.parse(res.text)?.data;
      if (!user) return;

      return {
         url: originalUrl,
         title: `u/${user.name}`,
         description: user.subreddit?.public_description?.trim() || undefined,
         host: "www.reddit.com",
         favicon: "https://www.reddit.com/favicon.ico",
         image: user.icon_img?.split("?")[0] || undefined,
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

      const item = JSON.parse(res.text)?.d?.[0];
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

      const data = JSON.parse(apiRes.text);
      const stars: number = data.stargazers_count ?? 0;
      const starsLabel = stars >= 1000
         ? `${(stars / 1000).toFixed(1)}k`
         : String(stars);

      const descParts: string[] = [];
      if (data.description) descParts.push(data.description);
      if (data.language) descParts.push(data.language);
      descParts.push(`★ ${starsLabel}`);

      const ogImage = htmlRes?.text
         ? (htmlRes.text.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
            ?? htmlRes.text.match(/content="([^"]+)"\s+property="og:image"/i)?.[1])
         : undefined;

      return {
         url,
         title: data.full_name ?? `${owner}/${repo}`,
         author: owner,
         description: descParts.join(" · "),
         host: "github.com",
         favicon: "https://github.com/favicon.ico",
         image: ogImage ?? undefined,
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
         data = JSON.parse(res.text);
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

   /* --- WIKIPEDIA --- */
   private async fetchWikipedia(url: string): Promise<LinkMetadata | undefined> {
      const parsed = new URL(url);
      const lang = parsed.hostname.split(".")[0] ?? "en";
      const title = decodeURIComponent(parsed.pathname.replace(/^\/wiki\//, ""));

      const res = await this.request(
         `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (!res || res.status !== 200) return this.fetchGeneric(url);

      const data = JSON.parse(res.text);
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

   private async request(url: string, customHeaders: Record<string, string> = {}, timeoutMs = 5000) {
      const headers = {
         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
         "Accept-Language": "en-US,en;q=0.9",
         "Cache-Control": "no-cache",
         "Pragma": "no-cache",
         ...customHeaders
      };

      try {
         return await Promise.race([
            requestUrl({ url, headers }),
            new Promise<never>((_, reject) =>
               setTimeout(() => reject(new Error("Timeout")), timeoutMs)
            ),
         ]);
      } catch (e) {
         console.error(`Fetch failed for ${url}:`, e);
         return undefined;
      }
   }
}