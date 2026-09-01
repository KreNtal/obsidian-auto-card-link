# Domain coverage

Working notes for which sites the fetcher handles, what has been checked, and what
is known to be impossible. Not user documentation — the README covers usage.

Legend: ✅ works · 🟡 works, caveats · ⏳ not yet checked · ❌ unreachable (don't retry)

## Dedicated fetchers

Sites with a handler in `link_metadata_fetcher.ts` (dispatched from `fetchForUrl`).
They answer from an API / oEmbed / JSON endpoint and never read the page HTML, so the
site name comes from `SITE_NAMES`, not `og:site_name`.

| Site | Status | URL forms | Notes |
|------|--------|-----------|-------|
| YouTube | ✅ | video, `shorts/`, `playlist?`, `@`/`c/`/`channel/` | oEmbed + page scrape for description/duration; thumbnail quality setting |
| Vimeo | ⏳ | `vimeo.com/<id>`, `player.vimeo.com` | oEmbed `api/oembed.json`; **not re-verified since the 1.6 work** |
| Dailymotion | ⏳ | `dailymotion.com/video/<id>`, `dai.ly/<id>` | public API for duration; **not re-verified** |
| Twitch | ✅ | channel, `/videos/<id>` (VOD), `/clip/`, `clips.twitch.tv` | SPA-shell retries with rotated UAs; sets `linkTitle` |
| TED | ⏳ | `ted.com/talks/<slug>` | og + JSON-LD VideoObject; **not re-verified** |
| Reddit | ✅ | `/r/<sub>`, `/u/<user>`, `/r/<sub>/comments/<id>` | oEmbed + `embed.reddit.com` + Atom feed; one feed request / minute / IP |
| X / Twitter | ✅ | `/status/<id>`, `/i/status/<id>`, profile, `/search`, `/hashtag/`, `/i/communities/` | tweet → `cdn.syndication.twimg.com/tweet-result` (quote tweet, card image); other pages → Twitterbot UA; `/i/lists/<id>` → URL-built `"X list"` (name unreachable) |
| IMDb | ✅ | `/title/tt…`, `/name/nm…`, other paths | suggestions API for tt/nm ids; URL fallback otherwise |
| Printables | ✅ | `printables.com/model/<id>` | GraphQL API → Googlebot page → URL slug |
| GitHub | 🟡 | repo root only (`owner/repo`) | REST API for `desc · lang · ★`; **rate-limited (60/h) → falls to page scrape with a poorer description** |
| Spotify | ✅ | `track`/`album`/`playlist`/`artist`/`episode`, `intl-<xx>/` | page (plugin UA) for localised label → oEmbed; sets `linkTitle` |
| Wikipedia | ✅ | `<lang>.wikipedia.org/wiki/<title>` | REST summary API; any language edition |

## Generic path — verified

Go through `fetchGeneric` (og/twitter/JSON-LD tags), with the microlink fallback if the
user enabled it. Roberto is verifying these in Obsidian.

| Site | Status | Notes |
|------|--------|-------|
| Amazon | ✅ | JSON-LD image, `#landingImage` DOM fallback |
| Thingiverse | ✅ | |
| Cults3D | ✅ | `twitter:image` points to the real asset |
| MakerWorld | ✅ | |
| Zhihu | 🟡 | serves an SPA shell to non-browsers; title can come back as the URL slug → microlink fallback helps |

## Rejected — do not retry

| Site | Reason |
|------|--------|
| free3d.com | DataDome. 403 to every UA tried (Googlebot, Twitterbot, Safari, Chrome). Needs TLS-fingerprint spoofing + residential proxies. |
| turbosquid.com | Same DataDome config (both are Shutterstock). |
| X lists — the list *name* | No endpoint exposes it. Syndication has none; GraphQL needs a rotating query id + bannable bearer token; X killed RSS in 2013; nitter is dead. `"X list"` is the accepted answer. |

## Backlog for 1.6

Big domains people paste into Obsidian, roughly by priority. Tick when a card has been
checked in Obsidian; add a row above with caveats if anything is odd.

- [ ] Vimeo / Dailymotion / TED — **re-verify the existing fetchers first**
- [ ] arXiv (`arxiv.org/abs/<id>`) — papers, very common in Obsidian vaults
- [ ] Stack Overflow / Stack Exchange
- [ ] Mastodon (any instance) — `/@user/<id>`
- [ ] Bluesky (`bsky.app/profile/<handle>/post/<id>`)
- [ ] Hacker News (`news.ycombinator.com/item?id=`)
- [ ] GitLab
- [ ] MDN
- [ ] npm / PyPI
- [ ] Medium / Substack
- [ ] Notion (public pages)
- [ ] Goodreads
- [ ] MyMiniFactory / Thangs (3D)
- [ ] News: BBC, The Verge, Ars Technica — also exercises the `•` separator in `appendSiteName`
- [ ] LinkedIn — login wall, expect degradation; check the fallback is graceful
