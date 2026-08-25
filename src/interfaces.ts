export interface LinkMetadata {
  url: string;
  title: string;
  author?: string;
  description?: string;
  host?: string;
  /** Human-readable name of the site ("YouTube", not "www.youtube.com"). */
  siteName?: string;
  /**
   * Label to use when the link is rendered inline instead of as a card, for the few
   * pages whose card title isn't a good link text (a Twitch channel's card shows the
   * current stream title, which is stale the next day; the channel name is not).
   */
  linkTitle?: string;
  favicon?: string;
  image?: string;
  duration?: string;
  indent: number;
}

/* ---- Typed API response interfaces ---- */

export interface OEmbedResponse {
  title: string;
  author_name?: string;
  thumbnail_url?: string;
  description?: string;
  duration?: number;
}

export interface DailymotionVideoResponse {
  title: string;
  description?: string;
  duration?: number;
  thumbnail_720_url?: string;
  "owner.screenname"?: string;
}

export interface PrintablesGraphQLResponse {
  data?: {
    print?: {
      name?: string;
      summary?: string;
      description?: string;
      images?: Array<{ filePath?: string; }>;
      user?: { publicUsername?: string; };
    };
  };
}

export interface ImdbSuggestionResponse {
  d?: Array<{ l: string; y?: number; s?: string; i?: { imageUrl?: string; }; }>;
}

export interface GitHubRepoResponse {
  full_name?: string;
  description?: string;
  language?: string;
  stargazers_count?: number;
}

export interface MicrolinkResponse {
  status?: string;
  data?: {
    title?: string;
    description?: string;
    author?: string;
    publisher?: string;
    image?: { url?: string; };
    logo?: { url?: string; };
    url?: string;
  };
}

export interface WikipediaSummaryResponse {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string; }; };
  thumbnail?: { source?: string; };
  originalimage?: { source?: string; };
}
