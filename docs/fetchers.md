# Fetcher index

One row per handler dispatched from `fetchForUrl` in `src/link_metadata_fetcher.ts`, grouped by
what the code actually does. This is the index; `docs/domain-coverage.md` stays the source of truth
for *why* each fetcher exists, what was tried and rejected, and the evidence behind every
exception. Nothing here overrides a field rule in `AGENTS.md`.

The grouping is the point. A **hook** is three lines on the generic path and costs nothing extra;
a **page** handler is our own request, with our own headers and its own parsing, which is the
expensive and fragile end (rule A6). Ask which group a proposal lands in before writing it.

**Requests** is the happy path, excluding the image download and the Microlink fallback.
**Dead link** is what proves the thing is gone — the invariant it serves: an API's *empty answer*
is proof, an API's *failure to answer* is not. **Cache** says "refresh" when a refresh bypasses it,
"sticky" when the cached card wins even on a refresh.

Keep this in step with the dispatch: a handler added, removed or changed in kind belongs here in
the same commit. Counts today: 19 endpoint, 4 page + endpoint, 9 page, 10 hook.

## Endpoint — answers from an API, oEmbed or JSON feed, never reads the page HTML

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| YouTube | oEmbed `youtube.com/oembed`; a `@handle` / `/c/` / `/channel/` page is read instead | 1 | — | oEmbed non-200 → card from the URL | low — documented oEmbed |
| Vimeo | oEmbed `vimeo.com/api/oembed.json` | 1 | — | **404** on a numeric id | low — documented oEmbed |
| Dailymotion | REST `api.dailymotion.com/video/<id>` | 1 | — | **404** | low — documented API |
| Reddit | oEmbed `reddit.com/oembed` for a post, then the `.rss` feed, then generic + `isUnusable` | 1–3 | refresh | empty feed, then the login-shell check | medium — the feed allows one request per minute |
| X / Twitter | syndication `cdn.syndication.twimg.com/tweet-result`, then the page, then the URL | 1–2 | — | empty syndication answer | **high** — undocumented internal endpoint |
| IMDb | suggestions `v2.sg.media-imdb.com/suggestion/x/<id>.json` | 1 | — | no match in the list | medium — undocumented, but long-lived |
| Printables | GraphQL `api.printables.com/graphql/`, then the page with a Googlebot UA, then the slug | 1–2 | — | no model in the answer | **high** — Cloudflare plus UA sniffing |
| GitHub | REST `api.github.com/repos/<owner>/<repo>`; the repo's HTML only when rate-limited | 1–2 | refresh | **404** from API or page | low — documented, 60 req/h anonymous |
| GitLab | REST `/api/v4/projects/<path>`, then `/api/v4/groups/<path>` | 1–2 | refresh | **404** from both — a missing project 302s to the sign-in page | low — documented, versioned |
| Bitbucket | REST `api.bitbucket.org/2.0/repositories/<workspace>/<repo>` — the repo root only; pages under a repo are built from the URL with no request | 0–1 | refresh | **404** → `<workspace>/<repo>` from the URL; an API failure lands on the same card, never generic | low — documented, versioned, 60 req/h anonymous |
| npm | `registry.npmjs.org/<pkg>/latest` + `api.npmjs.org/downloads/point/last-week` | 2 | refresh | registry **404** | low — documented registry |
| TikTok | a profile's page with the crawler UA, when its description starts with the `@handle`; otherwise, and for every video, oEmbed `tiktok.com/oembed` | 1–3 | sticky | **400** from oEmbed | low for videos — documented; **high** for profiles — UA sniffing, oEmbed behind it; thumbnails and avatars are signed and expire |
| Trello | the `.json` export any board URL answers to; a `/c/` card through REST `api.trello.com/1/cards/<id>` | 1 | refresh | **404** from the export or the card API | medium for boards — undocumented export; low for cards — documented API |
| Wikipedia | REST `<lang>.wikipedia.org/api/rest_v1/page/summary/<title>` | 1 | — | non-200 → generic, so a real **404** | low — documented, versioned |
| arXiv | Atom `export.arxiv.org/api/query?id_list=` | 1 | — | empty `<entry>` | low — documented API |
| Stack Exchange | `api.stackexchange.com/2.3/`, resolving an answer id to its question first | 1–2 | sticky | `items: []` | low — documented, 300 req/day anonymous |
| Hacker News | Firebase `hacker-news.firebaseio.com/v0/item\|user`, walking a comment up to its story | 1–6 | — | a literal `null`, or the `deleted` / `dead` flags | low — official API, no quota |
| Bluesky | XRPC `public.api.bsky.app/xrpc/` | 1 | — | error or missing handle → card from the URL | low — documented public AppView |
| AniList | GraphQL `graphql.anilist.co`, the `Media` query — `/anime/` and `/manga/` only; every other route reads the page with the plugin's UA, which AniList renders for non-browsers, and is built from the URL where it does not | 1 | refresh (API only) | **404** with `data.Media` null; a rendered page titled "AniList" | low for the API — documented, versioned, no key; **high** for character and staff — UA sniffing |

## Page + endpoint — the page first (A3), the endpoint only adds a field

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| Spotify | the page (artist, album, year, localised label); oEmbed only if the page fails | 1–2 | — | none of its own — falls through to generic | low — documented oEmbed as fallback |
| Steam | the page + `store.steampowered.com/api/appdetails` for the proof and the developers | 2 | refresh | `success:false` — a dead id 302s to the storefront | medium — public but unversioned |
| OpenStreetMap | the page + `api.openstreetmap.org/api/0.6/<type>/<id>` for the description only | 2 | refresh | **404** from the API | low — documented, versioned |
| Docker Hub | the page + `hub.docker.com/v2/repositories/<ns>/<name>/` for the description only | 1–2 | — | the page's own **404** — the endpoint is never reached | low — documented Hub API |

## Page — our own request, our own headers and parsing, no endpoint

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| Etsy | `fetchGeneric` with the WhatsApp UA, the whole host; " - Etsy …" dropped from the title, the shop read out of a listing's description or a shop page's title (B6, F4) | 1 | — | the page's own **404** | **high** — UA sniffing; every other UA is 403, Microlink `EPROXYNEEDED` |
| eBay | `fetchGeneric` with `viaNode`: on desktop the first request goes through Node's `https`, a current Chrome UA and its Client Hints (`sec-ch-ua`, which Electron drops from `requestUrl`); " \| eBay" dropped from an item's title (B6) | 1 | — | the page's own **404**; a bare `/itm/<id>` titled "eBay item" | **high** — header sniffing, and Node, so desktop only; mobile gets the 403 and falls back |
| Twitch | the page, 3 attempts with rotating user agents, 9s timeout | 1–3 | — | the shell → card from the URL plus furniture | **high** — UA sniffing and retries |
| TED | the page + speaker and ISO-8601 duration pulled from the HTML | 1 | — | non-200 → generic, so a real **404** | medium — HTML scraping for two fields |
| Google Docs / Drive | the page + a check on the redirect to `accounts.google.com` and a `<base href>` there | 1–2 | — | the sign-in redirect — a wall, not a death | medium — a redirect and an HTML tell |
| SoundCloud | the page + the homepage-shell check + `soundcloud:user` for the author (A5) | 1 | — | a real **404**, or the homepage shell a dead track answers with | medium — one title tell |
| LinkedIn | the page with the crawler UA (`facebookexternalhit`), then `fetchTitleOnly` | 1–2 | — | the sign-in wall → card from the URL | **high** — UA sniffing |
| Notion | the page with the crawler UA, which splits one shell into page / 404 / shell | 1 | sticky | a real **404**, or the marketing shell | **high** — UA sniffing |
| Discord | the invite page itself (the `/api/v10/invites/` endpoint was dropped 2026-09-11) | 1 | sticky | the front page an expired invite returns, spotted by its missing `og:url` | medium — one HTML tell; favicon hardcoded (G2) |

## Hook — `fetchGeneric` plus one check, or a touch-up of its result

No extra request, nothing site-specific to break.

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| Goodreads | `goneCard` | 1 | — | a 200 whose `og:title` is nothing but "Goodreads" | none |
| Google Maps | `goneCard`; the place name comes from the URL, the map thumbnail rides along | 1 | — | `og:title` "Google Maps" — the product, not the place | none — no endpoint exists for place data |
| Bandcamp | a `siteName` floor, nothing else | 1 | sticky | a real **404** | none — the Cloudflare-interstitial check it used to carry now runs in `fetchGeneric` for every link |
| Medium | `goneCard` | 1 | — | a title that is nothing but the site name | none |
| GOG | `goneCard`, `/game/` URLs only; " \| GOG.com" dropped from a live title (B6) | 1 | — | a 200 titled "Best Video games, DRM-free \| GOG.COM" — the catalog a missing game redirects to | low — a reworded catalog title only brings back the catalog card |
| AliExpress | `emptyPage`, `/item/<id>.html` only; " - AliExpress \<number>" dropped from a live title (B6) | 1 | — | a 200 whose `og:title` is declared empty | low — a changed empty page only brings back the Microlink call |
| Epic Games Store | `goneCard`, `/p/<slug>` URLs only | 1 | — | a 200 with no description and no image — the not-found page, its `<h1>` translated | low — a live page that stopped declaring both would be taken for dead |
| Google Play | a `urlCard` for the 404 branch: the title is the `?id=`, not the route word; an app's " - App su Google Play" tail dropped (B6) | 1 | — | a real **404** | none |
| itch.io | plain generic, then "\<title> by \<creators>" split into `author` when the first creator matches the subdomain or " by " occurs once | 1 | — | a real **404** | none — a template that stops matching leaves the title whole |
| Apple Podcasts | plain generic, then the show name read out of Apple's description template into `author` | 1 | — | a real **404** | none — a no-op on a show page |

## Where the rest lives

- `docs/domain-coverage.md` — the evidence: every site checked, what it returns, what was tried and
  rejected, the two-paste tests, and the release backlog.
- `AGENTS.md` — the field rules (A–I) that decide whether a site gets code at all and what that code
  may do to each field.
- `src/checkif.ts` — the matchers, one per handler. `src/interfaces.ts` — the response shapes for
  everything in the first two groups.
