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

export interface XSyndicationResponse {
  text?: string;
  /** [start, end] of the body without the trailing t.co media link X appends. */
  display_text_range?: [number, number];
  created_at?: string;
  lang?: string;
  favorite_count?: number;
  possibly_sensitive?: boolean;
  user?: {
    name?: string;
    screen_name?: string;
    profile_image_url_https?: string;
  };
  photos?: Array<{ url?: string; width?: number; height?: number; }>;
  mediaDetails?: Array<{ media_url_https?: string; type?: string; }>;
  /** Present when the tweet is a link with no native media - a preview card of the target. */
  card?: {
    name?: string;
    binding_values?: Record<string, {
      image_value?: { url?: string; width?: number; height?: number; };
      string_value?: string;
    }>;
  };
  quoted_tweet?: {
    text?: string;
    user?: { name?: string; screen_name?: string; };
  };
}

/** One entry of `api.stackexchange.com/2.3/sites`, the network's own site directory. */
export interface BlueskyAuthor {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export interface BlueskyPost {
  uri?: string;
  author?: BlueskyAuthor;
  record?: { text?: string; };
  /** Images and link cards; the shape varies by embed type. */
  embed?: {
    images?: Array<{ thumb?: string; fullsize?: string; }>;
    external?: { thumb?: string; };
    media?: { images?: Array<{ thumb?: string; fullsize?: string; }>; };
  };
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
}

export interface BlueskyProfile {
  handle?: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
}

export interface HackerNewsItem {
  id?: number;
  /** story | comment | job | poll | pollopt */
  type?: string;
  by?: string;
  title?: string;
  /** The link a story points at; absent on Ask HN, polls and comments. */
  url?: string;
  /** HTML, entity-escaped: the body of an Ask HN, a job ad or a comment. */
  text?: string;
  score?: number;
  descendants?: number;
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
}

export interface HackerNewsUser {
  id?: string;
  karma?: number;
  about?: string;
  created?: number;
}

export interface StackExchangeSite {
  api_site_parameter?: string;
  name?: string;
  /** SE's own one-liner, e.g. "professional and enthusiast programmers". */
  audience?: string;
  site_url?: string;
  favicon_url?: string;
  icon_url?: string;
  high_resolution_icon_url?: string;
}

export interface WikipediaSummaryResponse {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string; }; };
  thumbnail?: { source?: string; };
  originalimage?: { source?: string; };
}
