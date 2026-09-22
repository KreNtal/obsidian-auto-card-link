// Before a release: do the fragile handlers' sites still answer the way the code expects?
// `node scripts/check-fragile-sites.mjs` (add `-v` to see every check, not just failures).
//
// One check per tell a handler depends on - the UA that gets through, the title template, the
// not-found status or page - on the live and dead links it was built and tested with (see
// docs/domain-coverage.md). A script is a lower bound (AGENTS.md, rule 4): a pass does not
// prove the plugin gets through in Obsidian, but a failure where this used to pass is a real
// change, to be confirmed in Obsidian's console before touching any code. The links are real;
// if one is taken down, replace it with another real one, never a made-up id.
import { execFile } from "node:child_process";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PLUGIN = "Mozilla/5.0 (compatible; ObsidianAutoCardLink/1.0; +https://github.com/KreNtal/obsidian-auto-card-link)";
const CRAWLER = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const WHATSAPP = "WhatsApp/2.23.20.0";
// fetchEbay's headers, with its Chrome version counted the same way (chromeMajor).
const v = 140 + Math.floor((Date.now() - Date.UTC(2025, 8, 2)) / (28 * 864e5));
const EBAY = {
   curl: true,
   "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
   "sec-ch-ua": `"Chromium";v="${v}", "Not?A_Brand";v="24", "Google Chrome";v="${v}"`,
   "sec-ch-ua-mobile": "?0",
   "sec-ch-ua-platform": "\"Windows\"",
   "sec-fetch-dest": "document",
   "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
   "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
   "Accept-Encoding": "gzip, deflate, br",
};
const TWITCH = { "User-Agent": CHROME, "Referer": "https://www.google.com/", "Accept-Language": "en-US,en;q=0.9" };
const oembed = (endpoint, url) => `${endpoint}?url=${encodeURIComponent(url)}`;
const TIKTOK_OEMBED = "https://www.tiktok.com/oembed";
const RUMBLE_OEMBED = "https://rumble.com/api/Media/oembed.json";

// status: the expected status; test: what the answer must show, given
// { status, html, json, title (og:title, else <title>), desc (og:description), ogUrl }.
const checks = [
   // TikTok profile: readTikTokProfile, the crawler UA, the description starting with the @handle.
   ["TikTok profile, crawler page", "https://www.tiktok.com/@nasa", { "User-Agent": CRAWLER }, 200,
      (r) => /^@nasa /i.test(r.desc) && /^.+ \S+ TikTok$/.test(r.title)],
   ["TikTok profile, dead, oEmbed 400", oembed(TIKTOK_OEMBED, "https://www.tiktok.com/@nonexistentuserxyz123zz"), {}, 400],
   // TikTok tag: fetchTikTokPage, the crawler UA and "#tag <word> TikTok"; oEmbed 400 on a dead one.
   ["TikTok tag, crawler page", "https://www.tiktok.com/tag/nasa", { "User-Agent": CRAWLER }, 200,
      (r) => /^#nasa \S+ TikTok$/i.test(r.title)],
   ["TikTok tag, oEmbed 200", oembed(TIKTOK_OEMBED, "https://www.tiktok.com/tag/nasa"), {}, 200, (r) => /nasa/i.test(r.json?.title)],
   ["TikTok tag, dead, oEmbed 400", oembed(TIKTOK_OEMBED, "https://www.tiktok.com/tag/nonexistenttagxyz987654321"), {}, 400],

   // Etsy: fetchEtsy, WhatsApp's UA, " - Etsy …" and the shop sentence in an Italian listing.
   ["Etsy listing, WhatsApp", "https://www.etsy.com/it/listing/665351578/stoneware-mug-with-handle-stoneware", { "User-Agent": WHATSAPP }, 200,
      (r) => / - Etsy(\.[a-z.]+| [A-Z]\w+)?$/.test(r.title) && / di [A-Za-z0-9]+ è nei preferiti di /.test(r.desc)],
   ["Etsy shop, WhatsApp", "https://www.etsy.com/it/shop/PotteryProps", { "User-Agent": WHATSAPP }, 200, (r) => /^PotteryProps - Etsy/i.test(r.title)],
   ["Etsy listing, dead, 404", "https://www.etsy.com/listing/9999999999/fake-listing", { "User-Agent": WHATSAPP }, 404],

   // Booking.com: the cascade's crawler UA; a closed listing redirected to its city (goneCard).
   ["Booking hotel, crawler", "https://www.booking.com/hotel/it/artemide.html", { "User-Agent": CRAWLER }, 200, (r) => /\/hotel\//.test(r.ogUrl)],
   ["Booking hotel, closed, city page", "https://www.booking.com/hotel/fr/ritz-paris.html", { "User-Agent": CRAWLER }, 200,
      (r) => /booking\.com\/(city|searchresults)[./]/.test(r.ogUrl)],
   ["Booking hotel, dead, 404", "https://www.booking.com/hotel/fr/nonexistenthotelxyz123.html", { "User-Agent": CRAWLER }, 404],

   // eBay: fetchEbay's Chrome and Client Hints; " | eBay" once in an item's title.
   ["eBay item, Client Hints", "https://www.ebay.it/itm/274035155485", EBAY, 200, (r) => /\s\|\seBay$/.test(r.title) && r.title.split("|").length === 2],
   ["eBay item, dead, 404", "https://www.ebay.it/itm/100000000001", EBAY, 404],

   // Twitch: fetchTwitch, a double-quoted og:title that is not the shell, and its templates.
   ["Twitch channel", "https://www.twitch.tv/shroud", TWITCH, 200, (r) => /^shroud - (Live on )?Twitch$/.test(r.twitchTitle), 3],
   ["Twitch clip", "https://www.twitch.tv/shroud/clip/TangentialBillowingJalapenoYee-ccA2oB1pEYh4CHWJ", TWITCH, 200,
      (r) => / - shroud on Twitch$/.test(r.twitchTitle), 3],
   // The shell is marked dead too (fetchTwitch's last branch), so either answer holds.
   ["Twitch VOD, dead, stock title or shell", "https://www.twitch.tv/videos/1", TWITCH, 200,
      (r) => r.twitchTitle === "VOD - Twitch" || r.twitchTitle === undefined],
   ["Twitch channel, dead, shell", "https://www.twitch.tv/zzqq_no_such_channel_81723", TWITCH, 200, (r) => r.twitchTitle === undefined],

   // Kick: fetchKick's templates and not-found title, its two endpoints.
   ["Kick channel", "https://kick.com/xqc", { "User-Agent": PLUGIN }, 200, (r) => /^xQc Stream - Watch Live on Kick$/i.test(r.title)],
   ["Kick channel, dead", "https://kick.com/nonexistentuserxyz123abc", { "User-Agent": PLUGIN }, 200, (r) => /Not Found - Kick Streaming$/.test(r.title)],
   ["Kick video endpoint", "https://kick.com/api/v1/video/d252b88b-188e-4d38-ac65-278ad209dff4", { "User-Agent": PLUGIN }, 200,
      (r) => !!r.json?.livestream?.session_title],
   ["Kick video endpoint, dead, 404", "https://kick.com/api/v1/video/00000000-1111-2222-3333-444444444444", { "User-Agent": PLUGIN }, 404],
   ["Kick clip endpoint", "https://kick.com/api/v2/clips/clip_01H811MXG4FBR62FXPE1AXABDH", { "User-Agent": PLUGIN }, 200, (r) => !!r.json?.clip?.title],
   ["Kick clip endpoint, dead, 404", "https://kick.com/api/v2/clips/clip_00000000000000000000000000", { "User-Agent": PLUGIN }, 404],

   // Rumble: fetchRumble, the page behind its cookie redirect, then oEmbed.
   ["Rumble video page, cookie redirect", "https://rumble.com/v7do7xk-the-final-unsettling-chapter-sf746.html", { "User-Agent": CHROME, cookies: true }, 200,
      (r) => /Final Unsettling Chapter/i.test(r.title)],
   ["Rumble oEmbed", oembed(RUMBLE_OEMBED, "https://rumble.com/v7do7xk-the-final-unsettling-chapter-sf746.html"), {}, 200,
      (r) => !!r.json?.title && !!r.json?.author_name],
   ["Rumble oEmbed, dead, 404", oembed(RUMBLE_OEMBED, "https://rumble.com/v7zzzzz-nonexistent-video-xyz.html"), {}, 404],
];

const meta = (html, prop) => html.match(new RegExp(`property=["']${prop}["'][^>]*content=["']([^"']*)`, "i"))?.[1]
   ?? html.match(new RegExp(`content=["']([^"']*)["'][^>]*property=["']${prop}["']`, "i"))?.[1];
const decode = (s) => s?.replace(/&amp;/g, "&").replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, "\"").trim();

// eBay's Akamai refuses standalone Node's TLS fingerprint whatever the headers, where curl and
// the Node inside Electron (BoringSSL, as in Chrome) get through: 2026-09-22, the same request
// was 403 from Node and 200 from curl. So those checks go through curl.
function viaCurl(url, headers) {
   const args = ["-s", "-L", "--compressed", "-m", "15", "-w", "\n%{http_code}", url];
   for (const [k, val] of Object.entries(headers)) args.push("-H", `${k}: ${val}`);
   return new Promise((resolve, reject) => execFile("curl", args, { maxBuffer: 1 << 26 }, (err, out) => {
      if (err) return reject(err);
      const cut = out.lastIndexOf("\n");
      resolve({ status: Number(out.slice(cut + 1)), text: () => Promise.resolve(out.slice(0, cut)) });
   }));
}

// Rumble answers a 307 to itself setting a cookie, and serves the page only with it back.
async function get(url, { cookies, curl, ...headers }) {
   if (curl) return viaCurl(url, headers);
   if (!cookies) return fetch(url, { headers, signal: AbortSignal.timeout(15000) });
   let jar = "";
   for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(url, { headers: { ...headers, Cookie: jar }, redirect: "manual", signal: AbortSignal.timeout(15000) });
      if (res.status < 300 || res.status >= 400) return res;
      jar = [jar, ...res.headers.getSetCookie().map((c) => c.split(";")[0])].filter(Boolean).join("; ");
      url = new URL(res.headers.get("location"), url).href;
   }
   throw new Error("too many redirects");
}

// eBay's bot wall: its 403 "Error Page" and the challenge it redirects a busy IP to. eBay answers
// scripts with it now and then while Obsidian reads the same item (ebay.com/itm/145603349152 was
// 403 to curl and read in Obsidian, 2026-09-22), so it is reported apart and proves nothing (rule 4).
const BLOCKED = /^(Error Page \| eBay|Ci scusiamo per l'interruzione|Pardon Our Interruption)/;

async function run([name, url, headers, status, test = () => true, tries = 1]) {
   let why = "";
   for (let i = 0; i < tries; i++) {
      try {
         const res = await get(url, headers);
         const html = await res.text();
         let json;
         try { json = JSON.parse(html); } catch { /* a page */ }
         const r = {
            status: res.status, html, json,
            title: decode(meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)/i)?.[1]) ?? "",
            // isTwitchResponseUsable reads og:title double-quoted only, in either order; the shell's is single-quoted.
            twitchTitle: decode((html.match(/property="og:title"\s+content="([^"]*)"/i)
               ?? html.match(/content="([^"]*)"\s+property="og:title"/i))?.[1]),
            desc: decode(meta(html, "og:description")) ?? "",
            ogUrl: meta(html, "og:url") ?? html.match(/rel=["']canonical["'][^>]*href=["']([^"']*)/i)?.[1] ?? "",
         };
         if (r.status === status && test(r)) return { name, ok: true };
         if (BLOCKED.test(r.title)) return { name, blocked: true, why: `"${r.title}" - rerun later, or paste it in Obsidian\n     ${url}` };
         why = `${r.status}, title "${r.title.slice(0, 70)}"${r.ogUrl ? `, og:url ${r.ogUrl.slice(0, 70)}` : ""}`;
      } catch (e) {
         why = e.message;
      }
   }
   return { name, ok: false, why: `expected ${status}, got ${why}\n     ${url}` };
}

const verbose = process.argv.includes("-v");
const results = await Promise.all(checks.map(run));
for (const r of results) {
   if (!r.ok) console.log(`${r.blocked ? "WALL" : "FAIL"} ${r.name}: ${r.why}`);
   else if (verbose) console.log(`ok   ${r.name}`);
}
const failed = results.filter((r) => !r.ok && !r.blocked).length;
const walled = results.filter((r) => r.blocked).length;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} as expected${walled ? `, ${walled} behind a bot wall` : ""}.`);
process.exitCode = failed ? 1 : 0;
