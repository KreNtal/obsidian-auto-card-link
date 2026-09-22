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
the same commit. Counts today: 22 endpoint, 13 page + endpoint, 11 page, 23 hook.

## Endpoint — answers from an API, oEmbed or JSON feed, never reads the page HTML

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| YouTube | oEmbed `youtube.com/oembed`; a `@handle` / `/c/` / `/channel/` page is read instead | 1 | — | oEmbed **400** (a video) or **404** (a playlist) → card from the URL; a 401 or no answer gets the same card, unmarked | low — documented oEmbed |
| Vimeo | oEmbed `vimeo.com/api/oembed.json` | 1 | — | **404** on a numeric id | low — documented oEmbed |
| Dailymotion | REST `api.dailymotion.com/video/<id>` | 1 | — | **404** | low — documented API |
| Reddit | oEmbed `reddit.com/oembed` for a post, then the `.rss` feed, then generic + `isUnusable` | 1–3 | refresh | empty feed, then the login-shell check | medium — the feed allows one request per minute |
| X / Twitter | syndication `cdn.syndication.twimg.com/tweet-result`, then the page, then the URL | 1–2 | — | empty syndication answer | **high** — undocumented internal endpoint |
| IMDb | suggestions `v2.sg.media-imdb.com/suggestion/x/<id>.json` | 1 | — | no entry carrying this id - the endpoint is a search and answers a dead id with look-alikes | medium — undocumented, but long-lived |
| Printables | GraphQL `api.printables.com/graphql/`, then the page with a Googlebot UA, then the slug | 1–2 | — | no model in the answer | **high** — Cloudflare plus UA sniffing |
| GitHub | REST `api.github.com/repos/<owner>/<repo>`; the repo's HTML only when rate-limited | 1–2 | refresh | **404** from API or page | low — documented, 60 req/h anonymous |
| GitLab | REST `/api/v4/projects/<path>`, then `/api/v4/groups/<path>` | 1–2 | refresh | **404** from both — a missing project 302s to the sign-in page | low — documented, versioned |
| Bitbucket | REST `api.bitbucket.org/2.0/repositories/<workspace>/<repo>` — the repo root only; pages under a repo are built from the URL with no request | 0–1 | refresh | **404** → `<workspace>/<repo>` from the URL; an API failure lands on the same card, never generic | low — documented, versioned, 60 req/h anonymous |
| npm | `registry.npmjs.org/<pkg>/latest` + `api.npmjs.org/downloads/point/last-week` | 2 | refresh | registry **404** | low — documented registry |
| crates.io | `crates.io/api/v1/crates/<name>?include=` (or `/<version>`) + `/owner_user`; the page, a shell, is read only for its per-crate `og:image` and favicon. Users, teams, keywords and categories: `/api/v1/<kind>/<id>` + the page for furniture | 2–3 | refresh (crates) | API **404** → the name verbatim (crates) or the URL card; an API failure lands on the same card, never generic | low — documented API |
| TikTok | a profile's page with the crawler UA, when its description starts with the `@handle`; otherwise, and for every video, oEmbed `tiktok.com/oembed`. A tag: its page with the crawler UA, else oEmbed. Discover, LIVE, photo: the generic read, and a card from the URL when it is the login wall | 1–3 | sticky | **400** from oEmbed | low for videos — documented; **high** for profiles and tags — UA sniffing, oEmbed behind it; thumbnails and avatars are signed and expire |
| Trello | the `.json` export any board URL answers to; a `/c/` card through REST `api.trello.com/1/cards/<id>` | 1 | refresh | **404** from the export or the card API | medium for boards — undocumented export; low for cards — documented API |
| Jira Cloud | REST `<site>.atlassian.net/rest/api/2/issue/<key>` — `/browse/<KEY>-<n>` only | 1 | refresh | none: a missing and a private issue are the same **404**, read as a wall (a declared exception to J1) → the key, unmarked | low — documented, versioned |
| Wikipedia | REST `<lang>.wikipedia.org/api/rest_v1/page/summary/<title>` | 1 | — | non-200 → generic, so a real **404** | low — documented, versioned |
| arXiv | Atom `export.arxiv.org/api/query?id_list=` | 1 | — | empty `<entry>` | low — documented API |
| PubMed | E-utilities `eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml` | 1 | — | an empty `<PubmedArticleSet>` | low — documented, 3 req/s anonymous |
| Stack Exchange | `api.stackexchange.com/2.3/`, resolving an answer id to its question first | 1–2 | sticky | `items: []` | low — documented, 300 req/day anonymous |
| Hacker News | Firebase `hacker-news.firebaseio.com/v0/item\|user`, walking a comment up to its story | 1–6 | — | a literal `null`, or the `deleted` / `dead` flags | low — official API, no quota |
| Bluesky | XRPC `public.api.bsky.app/xrpc/` | 1 | — | a **400** reading "not found" → card from the URL; any other failure gets the same card, unmarked | low — documented public AppView |
| AniList | GraphQL `graphql.anilist.co`, the `Media` query — `/anime/` and `/manga/` only; every other route reads the page with the plugin's UA, which AniList renders for non-browsers, and is built from the URL where it does not | 1 (2 when a user, character, staff or studio page fails) | refresh (API only) | **404** with `data.Media` null; for a user, character, staff member or studio whose page came back the shell, the same 404 with `data.<Type>` null | low for the API — documented, versioned, no key; **high** for character and staff — UA sniffing |

## Page + endpoint — the page first (A3), the endpoint only adds a field

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| Spotify | the page (artist, album, year, localised label); oEmbed only if the page fails | 1–2 | — | none of its own — falls through to generic | low — documented oEmbed as fallback |
| Steam | the page + `store.steampowered.com/api/appdetails` for the proof and the developers | 2 | refresh | `success:false` — a dead id 302s to the storefront | medium — public but unversioned |
| OpenStreetMap | the page + `api.openstreetmap.org/api/0.6/<type>/<id>` for the description only | 2 | refresh | **404** from the API | low — documented, versioned |
| Docker Hub | the page + `hub.docker.com/v2/repositories/<ns>/<name>/` for the description only | 1–2 | — | the page's own **404** — the endpoint is never reached | low — documented Hub API |
| RubyGems | the page + `rubygems.org/api/v1/gems/<name>.json` (v2 for a version) for the description and authors; " \| RubyGems.org \| your community gem host" dropped (B6) | 1–2 | — | the page's own **404** — the endpoint is never reached | low — documented API |
| DOI | the page the DOI lands on; when it cannot be read, CSL-JSON from `doi.org` by content negotiation instead of Microlink - the endpoint replaces a failed read rather than adding a field | 1–4 | — | doi.org's own **404** → the DOI as title | low — documented content negotiation, Crossref and DataCite alike |
| bioRxiv | the page; `api.biorxiv.org/details/biorxiv/<doi>` only when it is the "\| bioRxiv" `/node` page, which reads as no preprint | 1–2 | — | that page, then `collection: []` from the API | low — documented API |
| Telegram | the page; a post's embed `t.me/<handle>/<n>?embed=1` after it, for the proof only; a handle's dead page is a `goneCard` on its `og:title` | 1 (2 for a post) | — | `og:title` "Telegram: Contact @\<handle>"; the embed's "Post not found" or "Channel with username … not found" | low — the embed is Telegram's published widget; a reworded error only brings back the channel's card |
| Tumblr | the page, `www.tumblr.com/<blog>[/<id>]`; oEmbed `www.tumblr.com/oembed/1.0` only when a post came back as its blog's page, titled with the blog's template; a blog's " su Tumblr" dropped and its name made author (B6, F4); a post titled from its `<title>` template, "@\<blog>" as author (B7) | 1–2 | — | the oEmbed's **404**; every other dead shape is the page's own **404** | low — documented oEmbed |
| Wiktionary (English) | the page; `en.wiktionary.org/api/rest_v1/page/definition/<word>` only when it gave no description, which it never does today - the first English entry's first definition, composed with its language and part of speech; " - Wiktionary, the free dictionary" dropped (B6) | 2 | — | the page's own **404** — the endpoint is never reached | low — documented Wikimedia REST API, en.wiktionary only |
| Jira, self-hosted | the page; `<base>/rest/api/2/issue/<key>` only when its title does not open with "[KEY]" - a "Loading..." shell or the instance's sign-in page | 1–2 | refresh | none: Jira's `errorMessages` ("Issue Does Not Exist", "You do not have the permission…") read as a wall → the key, unmarked | low — documented, versioned API; any host, so a non-Jira `/browse/X-1` page costs one extra request |
| Kick | the page, with a `goneCard` on "… Not Found - Kick Streaming"; a VOD straight from `kick.com/api/v1/video/<uuid>`, as its page is always empty; a clip's `kick.com/api/v2/clips/<id>` only when its page is empty; the channel from the title template into `author` (B6) | 1–2 | — | the not-found page's title; a **404** from either endpoint | **high** — two undocumented internal endpoints |
| Rumble | a video's page through Node's `https` on desktop, carrying the `RNSC` cookie its 307-to-itself sets; then the declared oEmbed `rumble.com/api/Media/oembed.json` for the author and duration. On mobile and for `/embed/` URLs the oEmbed alone | 2 (1 on mobile) | — | the page's own **404**, or the oEmbed's **404** "Media not found" | low — declared oEmbed; the page read is desktop-only |

## Page — our own request, our own headers and parsing, no endpoint

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| Etsy | `fetchGeneric` with the WhatsApp UA, the whole host; " - Etsy …" dropped from the title, the shop read out of a listing's description or a shop page's title (B6, F4) | 1 | — | the page's own **404** | **high** — UA sniffing; every other UA is 403, Microlink `EPROXYNEEDED` |
| eBay | `fetchGeneric` with `viaNode`: on desktop the first request goes through Node's `https`, a current Chrome UA and its Client Hints (`sec-ch-ua`, which Electron drops from `requestUrl`); " \| eBay" dropped from an item's title (B6) | 1 | — | the page's own **404**; a bare `/itm/<id>` titled "eBay item" | **high** — header sniffing, and Node on desktop; mobile's own requestUrl read a listing too (2026-09-18) |
| Yelp | `fetchGeneric` on `yelp.co.uk` for a `/biz/` link on `.com` or `.ca`, same path and query; the card keeps the pasted URL and host | 1 | — | the mirror's own **404** | medium — an undocumented difference between Yelp's hosts; `.com` and `.ca` are DataDome to every request |
| Twitch | the page, 3 attempts with rotating user agents, 9s timeout | 1–3 | — | the shell → card from the URL plus furniture | **high** — UA sniffing and retries |
| TED | the page + speaker and ISO-8601 duration pulled from the HTML | 1 | — | non-200 → generic, so a real **404** | medium — HTML scraping for two fields |
| Google Docs / Drive | the page + a check on the redirect to `accounts.google.com` and a `<base href>` there | 1–2 | — | the sign-in redirect — a wall, not a death | medium — a redirect and an HTML tell |
| SoundCloud | the page + the homepage-shell check + `soundcloud:user` for the author (A5) | 1 | — | a real **404**, or the homepage shell a dead track answers with | medium — one title tell |
| LinkedIn | the page with the crawler UA (`facebookexternalhit`), then `fetchTitleOnly` | 1–2 | — | the sign-in wall → card from the URL | **high** — UA sniffing |
| Notion | the page with the crawler UA, which splits one shell into page / 404 / shell | 1 | sticky | a real **404**, or the marketing shell | **high** — UA sniffing |
| Discord | the invite page itself (the `/api/v10/invites/` endpoint was dropped 2026-09-11) | 1 | sticky | the front page an expired invite returns, spotted by its missing `og:url` | medium — one HTML tell; favicon hardcoded (G2) |
| Confluence Cloud | the page; "Page Not Found - Confluence" and a **401** read as walls → card from the URL, unmarked; "<page> - <space> - Confluence" split into title and `author` (B6) | 1 | — | none: a missing and a restricted page look the same, so both are walls (as Jira) | medium — one English title tell |

## Hook — `fetchGeneric` plus one check, or a touch-up of its result

No extra request, nothing site-specific to break.

| Site | Source | Req. | Cache | Dead link | Fragility (A6) |
| --- | --- | --- | --- | --- | --- |
| Goodreads | `goneCard` | 1 | — | a 200 whose `og:title` is nothing but "Goodreads" | none |
| Facebook | not `goneCard` - a bare "Facebook" title (no og tags) is replaced from the URL, but never marked not-found: the same shell answers a dead page and any route needing a session alike (2026-09-22) | 1 | — | none - J1 bars marking it, since a wall gives the identical shell | none |
| Google Maps | the place name comes from the URL, the map thumbnail rides along; a `maps.app.goo.gl` share link has no name in its own URL, so its resolved page is re-read for the one its UI carries (2026-09-22) | 1–2 | — | `og:title` "Google Maps" — the product, not the place | none — no endpoint exists for place data; the second request only on a short link |
| Bandcamp | a `siteName` floor, nothing else (`requestUrl` is challenged by Cloudflare; `fetchGeneric`'s Node retry reads it on desktop) | 1 | sticky | a real **404** | medium — the Node retry is desktop-only; on mobile the challenge goes to Microlink, which reads it (pasted on a phone, 2026-09-18); the Cloudflare-interstitial check it used to carry now runs in `fetchGeneric` for every link |
| Medium | `goneCard` | 1 | — | a title that is nothing but the site name | none |
| Odysee | `goneCard`, claim URLs only - any path but the home page and the app's `/$/` routes, which are titled "Odysee" alive | 1 | — | a 200 titled nothing but "Odysee", with the site's blurb and share image | low — a reworded not-found page only brings back the platform card |
| GOG | `goneCard`, `/game/` URLs only; " \| GOG.com" dropped from a live title (B6) | 1 | — | a 200 titled "Best Video games, DRM-free \| GOG.COM" — the catalog a missing game redirects to | low — a reworded catalog title only brings back the catalog card |
| AliExpress | `emptyPage`, `/item/<id>.html` only; " - AliExpress \<number>" dropped from a live title (B6) | 1 | — | a 200 whose `og:title` is declared empty | low — a changed empty page only brings back the Microlink call |
| Pinterest | `emptyPage`, the whole host and the country domains | 1 | — | a 200 with an empty `<title>` and nothing but `og:site_name` - a missing pin, profile or board | low — a changed empty page only brings back the Microlink call |
| Epic Games Store | `goneCard`, `/p/<slug>` URLs only | 1 | — | a 200 with no description and no image — the not-found page, its `<h1>` translated | low — a live page that stopped declaring both would be taken for dead |
| Google Play | a `urlCard` for the 404 branch: the title is the `?id=`, not the route word; an app's " - App su Google Play" tail dropped (B6) | 1 | — | a real **404** | none |
| Hugging Face | a `urlCard` for a repo root: `<owner>/<name>` verbatim, owner as author; " · Hugging Face" / " · Datasets at Hugging Face" dropped from a live title, a Space's " - a Hugging Face Space by \<owner>" moved into `author` (B6) | 1 | — | the **401** a missing or private repo answers, which `fetchGeneric` now reads like a 404 for every site | none — a template that stops matching leaves the title whole |
| Packagist | `goneCard`, `/packages/<vendor>/<name>` only; " - Packagist.org" dropped from a live title and the vendor made author, over the site-wide "Jordi Boggiano" (B6) | 1 | — | a 200 titled "Packagist.org" — the search page a missing package redirects to | none — a template that stops matching leaves the title whole |
| Hashnode | `goneCard`, hashnode.com's `/@<handle>`, `/n/<tag>` and `/tag/<tag>` only; a live profile's " \| Hashnode" dropped, the name made author (B6, F4) | 1 | — | a 200 titled "User not found \| Hashnode" or "Tag not found \| Hashnode" | none — a reworded title only brings back the platform card |
| itch.io | plain generic, then "\<title> by \<creators>" split into `author` when the first creator matches the subdomain or " by " occurs once | 1 | — | a real **404** | none — a template that stops matching leaves the title whole |
| Apple Podcasts | plain generic, then the show name read out of Apple's description template into `author` | 1 | — | a real **404** | none — a no-op on a show page |
| Linear | plain generic, then a result titled nothing but "Linear", with no description or image - the app shell every workspace route answers - becomes a card from the URL: an issue's slug or key, a project's or document's slug without its id | 1 | — | none: live and missing are the same shell, so the card is unmarked | low — a reworded shell only brings back the "Linear" card |
| ClickUp | plain generic on the app hosts, then a result titled nothing but "ClickUp" or "ClickUp Docs" - the shell every task and doc answers - becomes a card from the URL with the shell's blurb and image: a doc's slug, a task's custom id, else "ClickUp doc" / "ClickUp task" | 1 | — | none: live and missing are the same shell, so the card is unmarked | low — a reworded shell only brings back the "ClickUp" card |
| TripAdvisor | plain generic on `<Type>_Review-g…-d…-Reviews-` pages, with its own `urlCard` and a `fallback` that is that card instead of Microlink: the name after `-Reviews-` ("Hotel Reginella"), `siteName` "Tripadvisor" | 1 | — | a real **404** would build the same card, marked; DataDome's 403 is a wall, unmarked | none — the name is the URL's own |
| JSFiddle | plain generic on `…/show/` result views, then a result titled "Log in …" - the sign-in page every live one redirects to - reads the fiddle's own page (the path without `/show/`) instead, keeping the pasted URL; if that fails too, the fiddle's id from the URL with the sign-in page's blurb | 1–2 | — | a real **404**, from the first request | low — a reworded sign-in title only brings back the "Log in" card |
| Replit | plain generic on `/@<user>` profiles, then a result titled "Sign Up" - the page every existing profile redirects to - becomes a card from the URL: the handle verbatim, with the sign-up page's blurb and image | 1 | — | a real **404** for a missing user; an existing profile's card is unmarked | low — a reworded sign-up title only brings back the "Sign Up" card |
| Coda / Superhuman Docs | plain generic on `/d/` docs, then a result titled nothing but "Login", with no description or image - the sign-in page a private or missing doc redirects to - becomes a card from the URL: the doc's name, else the page's | 1 | — | none: private and missing land on the same sign-in page, so the card is unmarked | low — a reworded sign-in page only brings back the "Login" card |
| Booking.com | `fetchGeneric` on a `/hotel/` link, with a `goneCard` on the page's `og:url` or canonical pointing at `/city/` or `/searchresults` - where a closed listing is redirected | 1–6 | — | that redirect; the page's own **404** | **high** — the cascade's crawler UA past a 202 challenge, and an undocumented redirect |

## Where the rest lives

- `docs/domain-coverage.md` — the evidence: every site checked, what it returns, what was tried and
  rejected, the two-paste tests, and the release backlog.
- `AGENTS.md` — the field rules (A–I) that decide whether a site gets code at all and what that code
  may do to each field.
- `src/checkif.ts` — the matchers, one per handler. `src/interfaces.ts` — the response shapes for
  everything in the first two groups.
