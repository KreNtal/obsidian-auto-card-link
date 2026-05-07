import { Notice, requestUrl } from "obsidian";
import { LinkMetadata } from "./interfaces";
import { LinkMetadataParser } from "./link_metadata_parser";
import { CheckIf } from "./checkif";

export class LinkMetadataFetcher {

   async fetch(url: string): Promise<LinkMetadata | undefined> {
      if (CheckIf.isYouTubeUrl(url)) return this.fetchYouTube(url);

      if (CheckIf.isRedditUrl(url)) return this.fetchReddit(url);

      if (CheckIf.isImdbUrl(url)) return this.fetchImdb(url);

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

      const parser = new LinkMetadataParser(url, res.text);
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

      return {
         url,
         title: LinkMetadataParser.sanitizeText(data.title) ?? data.title,
         description: LinkMetadataParser.sanitizeText(`By ${data.author_name}`),
         host: "www.youtube.com",
         favicon: "https://www.youtube.com/favicon.ico",
         image,
         indent: 0,
      };
   }

   private getYouTubeVideoId(url: string): string | undefined {
      return url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
   }

   private async getBestYouTubeThumbnail(videoId: string): Promise<string> {
      for (const q of ["maxresdefault", "sddefault", "hqdefault"]) {
         const thumbUrl = `https://i.ytimg.com/vi/${videoId}/${q}.jpg`;
         const res = await this.request(thumbUrl);
         if (res && res.status === 200) return thumbUrl;
      }
      return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
   }

   /* --- REDDIT --- */
   private async fetchReddit(url: string): Promise<LinkMetadata | undefined> {
      const normalized = url
         .replace("old.reddit.com", "www.reddit.com")
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

      const rawImage = post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&");
      const image = rawImage && !["self", "default", "nsfw", ""].includes(rawImage)
         ? rawImage : undefined;

      return {
         url: originalUrl,
         title: LinkMetadataParser.sanitizeText(post.title) ?? post.title,
         description: LinkMetadataParser.sanitizeText(
            post.selftext
               ? post.selftext.slice(0, 200).replace(/\n/g, " ") + "…"
               : `Posted by u/${post.author} in r/${post.subreddit}`
         ),
         host: "www.reddit.com",
         favicon: "https://www.reddit.com/favicon.ico",
         image,
         indent: 0,
      };
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

   /* --- SHARED HELPER --- */
   private async request(url: string, customHeaders: Record<string, string> = {}) {
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
               setTimeout(() => reject(new Error("Timeout")), 5000)
            ),
         ]);
      } catch (e) {
         console.error(`Fetch failed for ${url}:`, e);
         return undefined;
      }
   }
}