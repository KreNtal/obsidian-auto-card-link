// The field rules that hold for every site, checked on the deterministic code that applies them:
// the URL-built title (J2), deslug, the parser's universal cleanups (B2), the dead-link mark
// (J4), the markdown link's label (H1-H3), and the site templates (B6) that sit on top of
// fetchGeneric. `npm test`. No network: where a handler reads a page, fetchGeneric is replaced
// with the page's parsed answer. Each case is a regression that shipped, or a shape recorded
// in docs/domain-coverage.md. Parsing a page needs the browser's DOMParser, so what depends on
// the page's HTML itself (TikTok's templates, the Tumblr post's `<title>`) is not covered here.
import assert from "node:assert/strict";
import { LinkMetadataFetcher } from "../src/link_metadata_fetcher";
import { LinkMetadataParser } from "../src/link_metadata_parser";
import { CodeBlockGenerator } from "../src/code_block_generator";
import { LinkMetadata } from "../src/interfaces";

/* eslint-disable @typescript-eslint/no-explicit-any -- the rules under test are private */
const F = LinkMetadataFetcher as any;
const P = LinkMetadataParser as any;

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
   try {
      await fn();
   } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n").join("\n     ")}`);
   }
}

/** A fetcher whose generic read answers with `page`, and nothing else. */
function fetcherReading(page: Partial<LinkMetadata>): any {
   const f = new LinkMetadataFetcher() as any;
   f.fetchGeneric = (url: string) => Promise.resolve({ url, host: new URL(url).hostname, indent: 0, ...page });
   return f;
}

const titleOf = (url: string) => F.titleFromUrlPath(new URL(url));
const link = (title: string, siteName?: string) => CodeBlockGenerator.buildMarkdownLink(title, "https://example.com/a", siteName);

// J2: the URL-built title.
await test("J2: a single token is verbatim", () => assert.equal(titleOf("https://github.com/nonexistentorgxyz123"), "nonexistentorgxyz123"));
await test("J2: a slug of several words is deslugged", () => assert.equal(titleOf("https://www.bbc.com/news/some-deleted-story"), "Some deleted story"));
await test("J2: an id takes the whole path, not the route word", () => {
   assert.equal(titleOf("https://codeberg.org/forgejo/forgejo/issues/99999999"), "forgejo/forgejo/issues/99999999");
   assert.equal(titleOf("https://github.com/owner/repo/pull/123456"), "owner/repo/pull/123456");
});
await test("J2: Apple's trailing id<digits> is skipped", () => assert.equal(titleOf("https://podcasts.apple.com/us/podcast/some-show/id9999999999"), "Some show"));
await test("J2: the extension goes", () => assert.equal(titleOf("https://www.booking.com/hotel/fr/nonexistenthotelxyz123.html"), "nonexistenthotelxyz123"));
await test("J2: no path, no title", () => assert.equal(titleOf("https://example.com/"), undefined));

// deslug.
await test("deslug: sentence and title case", () => {
   assert.equal(F.deslug("the-invisible-man"), "The invisible man");
   assert.equal(F.deslug("the-invisible-man", "title"), "The Invisible Man");
   assert.equal(F.deslug("photo_carousel+trend"), "Photo carousel trend");
});
await test("deslug: percent-encoding decoded", () => assert.equal(F.deslug("caf%C3%A9-noir"), "Café noir"));
await test("deslug: no letters, nothing", () => {
   assert.equal(F.deslug("12345"), undefined);
   assert.equal(F.deslug(""), undefined);
});

// B2: the parser's universal cleanups.
await test("B2: whitespace, line breaks included, is one space", () =>
   assert.equal(LinkMetadataParser.sanitizeText("Pew! Pew! Pew!\n\n  Imagine"), "Pew! Pew! Pew! Imagine"));
await test("B2: entities decoded, quotes not escaped (2026-09-21)", () =>
   assert.equal(LinkMetadataParser.sanitizeText("&quot;benchy&quot; 3D Models &amp; more"), "\"benchy\" 3D Models & more"));
await test("B2: a dangling separator goes, a question mark stays", () => {
   assert.equal(P.trimTrailingSeparator("Pandas v Psycopg:"), "Pandas v Psycopg");
   assert.equal(P.trimTrailingSeparator("Who wins?"), "Who wins?");
   assert.equal(P.trimTrailingSeparator("---"), "---");
});
await test("B2: the site's own suffix stays", () => assert.equal(LinkMetadataParser.sanitizeText("Array.prototype.map() - JavaScript | MDN"), "Array.prototype.map() - JavaScript | MDN"));

// J4: the dead-link mark.
await test("J4: struck by default, only on not-found", () => {
   assert.equal(CodeBlockGenerator.notFoundTitle("Some story", "not-found"), "~~Some story~~");
   assert.equal(CodeBlockGenerator.notFoundTitle("Some story", undefined), "Some story");
   assert.ok(CodeBlockGenerator.isNotFound("seen, not-found"));
});
await test("J4: prefix and none follow the setting", () => {
   const s = (notFoundMarker: string, notFoundPrefix?: string) => ({ notFoundMarker, notFoundPrefix }) as any;
   assert.equal(CodeBlockGenerator.notFoundTitle("Some story", "not-found", s("prefix", "Non trovato:")), "Non trovato: Some story");
   assert.equal(CodeBlockGenerator.notFoundTitle("Some story", "not-found", s("none")), "Some story");
});
await test("J4: a 2026-09-17 card's ~~title~~ still reads as dead", () =>
   assert.equal(CodeBlockGenerator.notFoundTitle("~~Old~~", undefined, { notFoundMarker: "prefix", notFoundPrefix: "Not found:" } as any), "Not found: Old"));

// H1-H3: the markdown link's label.
await test("H1: title - site name", () => assert.equal(link("Prinz Eugen", "Wikipedia"), "[Prinz Eugen - Wikipedia](https://example.com/a)"));
await test("H2: the name as a whole word at either end is not repeated", () => {
   for (const [title, site] of [["The Verge", "The Verge"], ["Obsidian - Sharpen your thinking", "Obsidian"],
      ["Valve Complete Pack su Steam", "Steam"], ["How to use Spotify", "Spotify"]] as const) {
      assert.equal(link(title, site), `[${title}](https://example.com/a)`);
   }
});
await test("H2: a short form in the last segment is not repeated, and the pipe is escaped", () =>
   assert.equal(link("Array.prototype.map() | MDN", "MDN Web Docs"), "[Array.prototype.map() \\| MDN](https://example.com/a)"));
await test("H2: the site name after the strike, not inside it", () =>
   assert.equal(link("~~Some story~~", "BBC"), "[~~Some story~~ - BBC](https://example.com/a)"));
await test("H3: no site name, no suffix", () => assert.equal(link("Some story"), "[Some story](https://example.com/a)"));
await test("H: quotes escaped twice by old cards are undone, brackets escaped", () =>
   assert.equal(link("\\\"benchy\\\" [3D]"), "[\"benchy\" \\[3D\\]](https://example.com/a)"));
await test("H: a target with parentheses goes in angle brackets", () =>
   assert.equal(CodeBlockGenerator.buildMarkdownLink("A", "https://en.wikipedia.org/wiki/Foo_(bar)"), "[A](<https://en.wikipedia.org/wiki/Foo_(bar)>)"));

// B6: site templates on top of the generic read.
await test("B6 Kick: the channel is the author when it is the URL's", async () => {
   const card = await fetcherReading({ title: "xQc Stream - Watch Live on Kick" }).fetchKick("https://kick.com/xqc");
   assert.equal(card.title, "xQc Stream - Watch Live on Kick");
   assert.equal(card.author, "xQc");
   const clip = await fetcherReading({ title: "xQc - Watch clips on Kick" }).fetchKick("https://kick.com/xqc/clips/clip_01H811MXG4FBR62FXPE1AXABDH");
   assert.equal(clip.author, "xQc");
   const other = await fetcherReading({ title: "Amouranth Stream - Watch Live on Kick" }).fetchKick("https://kick.com/xqc");
   assert.equal(other.author, undefined);
});
await test("B6 Kick: the 2026-10 templates, the name last on a clip", async () => {
   const channel = await fetcherReading({ title: "xQc Live Stream - Watch Live on KICK" }).fetchKick("https://kick.com/xqc");
   assert.equal(channel.title, "xQc Live Stream - Watch Live on KICK");
   assert.equal(channel.author, "xQc");
   const clip = await fetcherReading({ title: "part 2 - AdinRoss Clip on KICK" }).fetchKick("https://kick.com/adinross/clips/clip_01M5CPMFG313RGP5AK0R3B1S6T");
   assert.equal(clip.author, "AdinRoss");
   const dashed = await fetcherReading({ title: "a - b - xQc Clip on KICK" }).fetchKick("https://kick.com/xqc/clips/clip_1");
   assert.equal(dashed.author, "xQc");
   const other = await fetcherReading({ title: "soda - xQc Clip on KICK" }).fetchKick("https://kick.com/adinross/clips/clip_1");
   assert.equal(other.author, undefined);
});
await test("B6 Twitch: '<title> - <channel> on Twitch', the channel the URL's", () => {
   assert.deepEqual(F.parseTwitchVideoTitle("Big play - shroud on Twitch", "shroud"), { title: "Big play", author: "shroud" });
   assert.equal(F.parseTwitchVideoTitle("Big play - someoneelse on Twitch", "shroud"), undefined);
   assert.equal(F.parseTwitchVideoTitle("shroud - Twitch", "shroud"), undefined);
});
await test("B6 Tumblr: a blog's name to the author, ' su Tumblr' goes", async () => {
   const named = await fetcherReading({ title: "NASA (@nasa) su Tumblr" }).fetchTumblr("https://nasa.tumblr.com/", "nasa");
   assert.equal(named.title, "NASA (@nasa)");
   assert.equal(named.author, "NASA");
   const bare = await fetcherReading({ title: "@staff" }).fetchTumblr("https://staff.tumblr.com/", "staff");
   assert.equal(bare.author, "@staff");
   const other = await fetcherReading({ title: "NASA (@nasa) su Tumblr" }).fetchTumblr("https://staff.tumblr.com/", "staff");
   assert.equal(other.title, "NASA (@nasa) su Tumblr");
});
await test("B6 Etsy: ' - Etsy …' once, the shop from the description", async () => {
   const card = await fetcherReading({
      title: "Tazza in gres con manico - Etsy Italia",
      description: "Questo articolo Tazze di PotteryProps è nei preferiti di 48 clienti di Etsy.",
   }).fetchEtsy("https://www.etsy.com/it/listing/665351578/stoneware-mug-with-handle-stoneware");
   assert.equal(card.title, "Tazza in gres con manico");
   assert.equal(card.author, "PotteryProps");
   const dashed = await fetcherReading({ title: "Mug - blue - Etsy" }).fetchEtsy("https://www.etsy.com/listing/1/mug");
   assert.equal(dashed.title, "Mug - blue - Etsy");
});
await test("B6 eBay: ' | eBay' once, on an item", async () => {
   const url = "https://www.ebay.it/itm/274035155485";
   assert.equal((await fetcherReading({ title: "Seagate Barracuda 8TB | eBay" }).fetchEbay(url)).title, "Seagate Barracuda 8TB");
   assert.equal((await fetcherReading({ title: "A | B | eBay" }).fetchEbay(url)).title, "A | B | eBay");
   assert.equal((await fetcherReading({ title: "tazza | eBay" }).fetchEbay("https://www.ebay.it/sch/i.html?_nkw=tazza")).title, "tazza | eBay");
});

// I4: Microlink fills only what a readable page left empty, and only when the user opted in.
await test("I4: fills the gaps, keeps what the page declared, drops the icon and a repeated title", async () => {
   const url = "https://offeco.nl/it/";
   const page: LinkMetadata = { url, title: "Home | Offeco", host: "offeco.nl", favicon: "https://offeco.nl/favicon.ico", indent: 0 };
   let calls = 0;
   const answering = (fields: string, extra: Partial<LinkMetadata>, external = true) => {
      const f = new LinkMetadataFetcher({ useExternalFallback: external, completeCards: fields } as any) as any;
      f.fetchViaMicrolink = () => { calls++; return Promise.resolve({ metadata: { url, title: "Home | Offeco", indent: 0, ...extra } }); };
      return f;
   };
   const both = { description: "Da Offeco trovi…", image: "https://offeco.nl/chair.webp" };
   const filled = await answering("both", both).fillFromMicrolink(url, page);
   assert.equal(filled.description, "Da Offeco trovi…");
   assert.equal(filled.image, "https://offeco.nl/chair.webp");
   assert.equal(filled.title, "Home | Offeco");
   const descOnly = await answering("description", both).fillFromMicrolink(url, page);
   assert.equal(descOnly.description, "Da Offeco trovi…");
   assert.equal(descOnly.image, undefined, "only the chosen field is filled");
   const imageOnly = await answering("image", both).fillFromMicrolink(url, page);
   assert.equal(imageOnly.image, "https://offeco.nl/chair.webp");
   assert.equal(imageOnly.description, undefined);
   calls = 0;
   assert.equal((await answering("off", both).fillFromMicrolink(url, page)).description, undefined);
   assert.equal((await answering("both", both, false).fillFromMicrolink(url, page)).description, undefined, "off with the external service");
   await answering("description", both).fillFromMicrolink(url, { ...page, description: "declared" });
   assert.equal(calls, 0, "no call when the chosen field is already there");
   const kept = await answering("both", { description: "other", image: "https://offeco.nl/other.webp" })
      .fillFromMicrolink(url, { ...page, description: "declared" });
   assert.equal(kept.description, "declared");
   assert.equal(kept.image, "https://offeco.nl/other.webp");
   const icon = await answering("both", { description: "home | offeco", image: "https://offeco.nl/logo.png", favicon: "https://offeco.nl/logo.png" }).fillFromMicrolink(url, page);
   assert.equal(icon.image, undefined);
   assert.equal(icon.description, undefined);
});

console.log(failed ? `\n${failed} failed.` : "All rules hold.");
process.exitCode = failed ? 1 : 0;
