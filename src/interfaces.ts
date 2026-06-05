export interface LinkMetadata {
  url: string;
  title: string;
  author?: string;
  description?: string;
  host?: string;
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

export interface RedditListingResponse {
  data?: { children?: Array<{ data?: RedditPostData; }>; };
}

export interface RedditPostData {
  title: string;
  subreddit?: string;
  selftext?: string;
  author?: string;
  url?: string;
  post_hint?: string;
  is_gallery?: boolean;
  media_metadata?: Record<string, { s?: { u?: string; }; }>;
  gallery_data?: { items?: Array<{ media_id: string; }>; };
  preview?: { images?: Array<{ source?: { url?: string; }; }>; };
}

export interface RedditSubredditData {
  display_name: string;
  public_description?: string;
  community_icon?: string;
  icon_img?: string;
}

export interface RedditUserData {
  name: string;
  subreddit?: { public_description?: string; };
  icon_img?: string;
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

export interface WikipediaSummaryResponse {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string; }; };
  thumbnail?: { source?: string; };
  originalimage?: { source?: string; };
}
