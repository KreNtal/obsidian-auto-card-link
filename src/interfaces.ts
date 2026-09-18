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
  /**
   * What is known about the link itself, as comma-separated words. Only "not-found" exists: the
   * site says the page is not there (field rule J4). The title stays clean, and how a dead
   * card is marked is decided when it is shown, by the setting as it is then.
   */
  status?: string;
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
  d?: Array<{ id?: string; l: string; y?: number; s?: string; i?: { imageUrl?: string; }; }>;
}

export interface GitHubRepoResponse {
  full_name?: string;
  description?: string;
  language?: string;
  stargazers_count?: number;
}

export interface GitLabProjectResponse {
  name?: string;
  name_with_namespace?: string;
  description?: string;
  star_count?: number;
  forks_count?: number;
  avatar_url?: string | null;
  namespace?: { name?: string; };
}

export interface BitbucketRepoResponse {
  full_name?: string;
  description?: string;
  workspace?: { name?: string; };
  links?: { avatar?: { href?: string; }; };
}

export interface DockerHubRepoResponse {
  namespace?: string;
  name?: string;
  description?: string;
  star_count?: number;
  pull_count?: number;
}

export interface CratesIoResponse {
  crate?: { name?: string; description?: string | null; };
  version?: { crate?: string; description?: string | null; };
}

export interface CratesIoOwnersResponse {
  users?: { login?: string; }[];
}

export interface RubyGemsResponse {
  authors?: string | null;
  info?: string | null;
}

export interface NpmPackageResponse {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  homepage?: string;
  author?: { name?: string; } | string;
}

/** `www.tiktok.com/oembed?url=...` - a profile or a video. */
export interface TikTokOEmbedResponse {
  title?: string;
  author_name?: string;
  author_unique_id?: string;
  thumbnail_url?: string;
}

/** `api.openstreetmap.org/api/0.6/<node|way|relation>/<id>.json` - one map object. */
export interface OsmElementResponse {
  elements?: Array<{
    type?: string;
    id?: number;
    tags?: Record<string, string>;
  }>;
}

/** `trello.com/b/<shortLink>.json?fields=name,desc,url,prefs` - a public board's export. */
export interface TrelloBoardResponse {
  name?: string;
  desc?: string;
  url?: string;
  prefs?: { backgroundImage?: string | null; };
}

/** `api.trello.com/1/cards/<shortLink>`, with the board's name and the cover's previews. */
export interface TrelloCardResponse {
  name?: string;
  desc?: string;
  board?: { name?: string };
  cover?: { scaled?: { url?: string; width?: number }[] | null };
}

/** One `appids=<id>` entry of `store.steampowered.com/api/appdetails`. */
export interface SteamAppDetailsResponse {
  [appid: string]: {
    success?: boolean;
    data?: {
      name?: string;
      type?: string;
      short_description?: string;
      header_image?: string;
      capsule_image?: string;
      developers?: string[];
      publishers?: string[];
    };
  } | undefined;
}

export interface MicrolinkResponse {
  status?: string;
  /** The HTTP status of the page Microlink itself read - not of the API call. */
  statusCode?: number;
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

/**
 * anilist.co GraphQL (`https://graphql.anilist.co`), the `Media` query. A missing id comes
 * back as HTTP 404 with `data.Media` null and an `errors` array, which is the API stating
 * the thing is not there - proof, unlike a 5xx or a dead network.
 */
export interface AniListMediaResponse {
  data?: {
    Media?: {
      type?: string;
      title?: { userPreferred?: string; romaji?: string; english?: string; native?: string; };
      description?: string;
      coverImage?: { extraLarge?: string; large?: string; };
      /** Anime only: the animation studio, `isMain` filtered in the query. */
      studios?: { nodes?: ({ name?: string; } | null)[]; };
      /** Manga: the first `Story & Art` edge is the author. */
      staff?: { edges?: ({ role?: string; node?: { name?: { full?: string; }; } | null; } | null)[]; };
    } | null;
  };
}

/**
 * The slice of Node's `https` and `zlib` that requestViaNode uses, written out rather than taken
 * from `@types/node`: the modules are required at run time, and without their types every call
 * on them would be `any` to the linter.
 */
export interface NodeResponse {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  resume(): void;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "end", listener: () => void): void;
}

export interface NodeHttps {
  get(url: string, options: { headers: Record<string, string>; }, callback: (res: NodeResponse) => void): {
    on(event: "error", listener: (error: Error) => void): void;
    setTimeout(ms: number, callback: () => void): void;
    destroy(error: Error): void;
  };
}

export interface NodeZlib {
  gunzipSync(data: Uint8Array): Uint8Array;
  inflateSync(data: Uint8Array): Uint8Array;
  brotliDecompressSync(data: Uint8Array): Uint8Array;
}
