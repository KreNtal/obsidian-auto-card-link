# Domain coverage

Working notes for which sites the fetcher handles, what has been checked, and what
is known to be impossible. Not user documentation — the README covers usage.

Legend: ✅ works · 🟡 works, caveats · ⏳ not yet checked · ❌ unreachable (don't retry)

## Dedicated fetchers

Sites with a handler in `link_metadata_fetcher.ts` (dispatched from `fetchForUrl`).
They answer from an API / oEmbed / JSON endpoint and never read the page HTML, so the
site name comes from `SITE_NAMES`, not `og:site_name`.

The `host` a card shows has a leading `www.` stripped in `fetch()`, once, for every path —
the generic one used to copy whatever the pasted URL happened to say, and the dedicated
fetchers were split roughly half and half between the two forms. Only the leading `www.`
goes: `open.spotify.com`, `en.wikipedia.org` and `clips.twitch.tv` keep their subdomain.
Nothing reads `host` for behaviour, so this is cosmetic; cards already in a vault keep the
form they were written with until refreshed.

All endpoints re-checked at the network layer on 2026-09-01: each still returns the
fields the code reads. Rendering in Obsidian (image load, layout, downloaded-image
path) is a separate spot-check — see the list at the bottom.

| Site        | Status | URL forms                                                                            | Notes                                                                                                                                                                                                              |
| ----------- | ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| YouTube     | ✅     | video, `shorts/`, `playlist?`, `@`/`c/`/`channel/`                                   | oEmbed + page scrape — `"shortDescription"` and `"lengthSeconds"` still in the watch-page HTML. Thumbnail quality setting.                                                                                         |
| Vimeo       | ✅     | `vimeo.com/<id>`, `player.vimeo.com/video/<id>`                                      | oEmbed `api/oembed.json` — all fields present. Thumbnail is ~295px (soft on retina); description can carry the video's own promo boilerplate. Non-video URLs (`vimeo.com/<user>`) 404 the oEmbed → `fetchGeneric`. |
| Dailymotion | ✅     | `dailymotion.com/video/<id>`, `dai.ly/<id>`                                          | `api.dailymotion.com/video/<id>` — title/description/duration/thumbnail_720_url/owner.screenname all returned. `dai.ly` id parsed directly, no redirect needed.                                                    |
| Twitch      | ✅     | channel, `/videos/<id>` (VOD), `/clip/`, `clips.twitch.tv`                           | channel page still serves real `og:*`. SPA-shell retries with rotated UAs; sets `linkTitle`. VOD/clip not re-checked with a live URL (they expire) — mechanism unchanged.                                          |
| TED         | ✅     | `ted.com/talks/<slug>`                                                               | `og:*`, `"duration":"PT…"`, `"presenterDisplayName"` all present; `pi.tedcdn.com` image still serves (200).                                                                                                        |
| Reddit      | ✅     | `/r/<sub>`, `/u/<user>`, `/r/<sub>/comments/<id>`                                    | oEmbed (title + author) + `embed.reddit.com` (200) + Atom feed — one feed request / minute / IP. Posts, profiles and subreddits all get Reddit's static branded tile from `share.redd.it/preview/…`. That endpoint ignores its argument — `/post/<id>`, `/user/<name>`, a made-up id and a nonexistent user all returned the identical 54014-byte file (sha1 `a9f3283…`) on 2026-09-02 — so the URL only picks which form is used, not which image comes back. Posts and profiles use the form Reddit declares as their own og:image; subreddits (whose declared og:image is just `redditstatic.com/shreddit/assets/favicon/192x192.png`, the favicon) borrow the post form. |
| X / Twitter | ✅     | `/status/<id>`, `/i/status/<id>`, profile, `/search`, `/hashtag/`, `/i/communities/` | tweet → `cdn.syndication.twimg.com/tweet-result` (quote tweet, card image); other pages → Twitterbot UA; `/i/lists/<id>` → URL-built `"X list"` (name unreachable)                                                 |
| IMDb        | ✅     | `/title/tt…`, `/name/nm…`, other paths                                               | `v2.sg.media-imdb.com/suggestion` — `l`/`y`/`s`/`i` all returned. URL fallback for other paths.                                                                                                                    |
| Printables  | ✅     | `printables.com/model/<id>`                                                          | GraphQL `api.printables.com/graphql` — `name`/`summary`/`description`/`images` returned. Then Googlebot page → URL slug.                                                                                           |
| GitHub      | ✅     | repo root only (`owner/repo`)                                                        | REST API for `desc · lang · ★`. When rate-limited (60/h/IP unauthenticated → 403) it rebuilds from the repo's own HTML — `"stargazerCount"` plus the description from an embedded JSON blob or a de-suffixed `og:description` — losing only the `· lang ·` segment. Session cache: a refresh or re-paste of a repo already seen costs no request. |
| Spotify     | ✅     | `track`/`album`/`playlist`/`artist`/`episode`, `intl-<xx>/`                          | page (plugin UA) gives `og:*` incl. `music.*` type → oEmbed fallback. Sets `linkTitle`.                                                                                                                            |
| Wikipedia   | ✅     | `<lang>.wikipedia.org/wiki/<title>`                                                  | REST summary API — title/extract/thumbnail. Any language edition.                                                                                                                                                  |
| arXiv       | ✅     | `/abs/<id>`, `/pdf/<id>`, `/format/`, `/html/` — `<id>` new (`1706.03762v3`) or old (`hep-th/9901001`), trailing `.pdf` stripped — plus the site root | Atom API `export.arxiv.org/api/query?id_list=` — title, full abstract, author list (`First et al.` for 3+), from the one `<entry>`. Image = arXiv's own logo (their og:image; a paper has no figure). The homepage has no `og:*` tags at all, so it reads generically (`<title>` + meta description) and only borrows that same logo. Bad id → no `<entry>` → generic + logo. `/list/`, `/a/<author>` aren't matched → generic. |
| Stack Exchange | ✅  | `/questions/<id>`, `/q/<id>`, `/a/<id>` on `stackoverflow.com`, `serverfault.com`, `superuser.com`, `askubuntu.com`, `stackapps.com`, `mathoverflow.net`, `*.stackexchange.com` (incl. `meta.*`) | The pages 403 non-browser requests and microlink can't get through, so cards come from `api.stackexchange.com/2.3` (`?site=<name>`, no auth). Title, asker, tags-free `<score> votes · <n> answers ✓ · <body excerpt>`. Answer links resolve to their question (2 calls). No image on question cards: the page's real og:image is behind the 403, and the only other mark any SE site offers is its `apple-touch-icon`, i.e. the favicon at a larger size — the card would show the same mark twice. StackOverflow's was used briefly and removed on 2026-09-03 for that reason. Quota 300/day/IP → session cache per `site:qid`. Deleted/missing id or a non-Q/A path → `fetchGeneric`. **Site front pages** (`https://<site>/`) get their own card from `/2.3/sites` — one site-less call returns all 365 network sites, so it is fetched once per session and covers every SE homepage: title = `name`, description = `Q&A for <audience>`, image = `high_resolution_icon_url` (the square mark; `logo_url` is a wide wordmark the thumbnail slot would crop to a fragment). |

## Generic path — verified

Go through `fetchGeneric` (og/twitter/JSON-LD tags), with the microlink fallback if the
user enabled it. Roberto is verifying these in Obsidian.

| Site        | Status | Notes                                                                                               |
| ----------- | ------ | --------------------------------------------------------------------------------------------------- |
| Amazon      | ✅     | JSON-LD image, `#landingImage` DOM fallback                                                         |
| Thingiverse | 🟡     | **Regressed 2026-09-02**: every model page now serves the same shell, so every card reads "Thingiverse - The community for Open Hardware" with the site logo. Left on the generic path deliberately — see the rejected table for what was tried, and why a URL-built `Thing <id>` card was tried and reverted. |
| Cults3D     | ✅     | `twitter:image` points to the real asset                                                            |
| MakerWorld  | ✅     |                                                                                                     |
| Zhihu       | 🟡     | serves an SPA shell to non-browsers; title can come back as the URL slug → microlink fallback helps |

## Rejected — do not retry

| Site                      | Reason                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| free3d.com                | DataDome. 403 to every UA tried (Googlebot, Twitterbot, Safari, Chrome). Needs TLS-fingerprint spoofing + residential proxies.                                                    |
| turbosquid.com            | Same DataDome config (both are Shutterstock).                                                                                                                                     |
| Thingiverse — a model's real title, description and image | Client-rendered SPA; the data comes from `api.thingiverse.com`, which is 401 without an OAuth token (no anonymous or app-token form works). Checked 2026-09-02 with browser/Googlebot/Twitterbot/facebookexternalhit UAs and against `/api/`, `_next/data`, oEmbed and RSS — all 401/403/404. Microlink's headless browser returns the same shell. Only a real OAuth token would fix it. The `thing:<id>` URL carries no slug, so nothing can be recovered from it either: a fetcher building `Thing 763622` from the id was written and reverted — a bare number means no more to a reader than the site blurb does, and the blurb at least renders as a normal card. |
| X lists — the list _name_ | No endpoint exposes it. Syndication has none; GraphQL needs a rotating query id + bannable bearer token; X killed RSS in 2013; nitter is dead. `"X list"` is the accepted answer. |

## Obsidian spot-check list

The network layer is verified; these need one card each pasted in Obsidian to confirm
rendering, image load, and (with the download settings on) the saved-image path.

- [x] YouTube — a video, a `shorts/`, a `playlist?`, a `@channel`
- [x] Vimeo — a normal video, a `player.vimeo.com/video/<id>`, a `vimeo.com/<user>` page
- [x] Dailymotion — a `dailymotion.com/video/<id>` and a `dai.ly/<id>`
- [x] Twitch — a live channel, a VOD, a clip (both `clips.twitch.tv/` and `/<chan>/clip/`)
- [x] TED — a talk
- [x] Reddit — a subreddit, a user, a text post, a link post, an image post
- [x] X — a text tweet, a link tweet (card image), a quote tweet, a profile, a `/search`, `/i/lists/<id>`
- [x] IMDb — a `/title/tt…`, a `/name/nm…`, a `/list/…`
- [x] Printables — a model
- [x] GitHub — a repo (and re-check once after hitting the rate limit)
- [x] Spotify — a track, an album, a playlist, an `intl-<xx>/` URL
- [x] Wikipedia — an English article, a non-English one (e.g. `it.wikipedia.org`)

## Backlog for 1.6

Big domains people paste into Obsidian, roughly by priority. Tick when a card has been
checked in Obsidian; add a row above with caveats if anything is odd.

- [x] arXiv — dedicated fetcher via the Atom API; needs an Obsidian render check (`/abs/`, `/pdf/`, an old `hep-th/…` id, a bad id)
- [x] Stack Overflow / Stack Exchange — dedicated fetcher via the SE API; needs an Obsidian render check (a question, a `/q/` and `/a/` short link, a non-SO site, an answer link, a dead id)
- [ ] LinkedIn — login wall, expect degradation; check the fallback is graceful
- [ ] Mastodon (any instance) — `/@user/<id>`
- [ ] Bluesky (`bsky.app/profile/<handle>/post/<id>`)
- [ ] Hacker News (`news.ycombinator.com/item?id=`)
- [ ] News: BBC, The Verge, Ars Technica — also exercises the `•` separator in `appendSiteName`
- [ ] GitLab
- [ ] MDN
- [ ] npm / PyPI
- [ ] Medium / Substack
- [ ] Goodreads
- [ ] MyMiniFactory / Thangs (3D)
- [ ] Notion (public pages)
