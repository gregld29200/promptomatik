// Transcription Studio — source classification and resolution.
//
// Two jobs, deliberately split:
//   `classifySource`  pure, synchronous, no network. Decides what a pasted
//                     string IS, and refuses everything we cannot honour with a
//                     typed failure the UI can explain.
//   `resolveSource`   network-touching. Turns a supported reference into a
//                     provider-fetchable audio URL (or the uploaded bytes).
//
// ---------------------------------------------------------------------------
// SSRF — this module is the only place where a teacher-supplied URL is fetched
// by our Worker, so every fetch here goes through `assertSafeUrl`:
//   * http/https only (no file:, data:, gopher:, ftp:, blob:, javascript:)
//   * no credentials in the URL (`http://user:pass@host` is refused outright —
//     it is never a legitimate podcast link and it is a classic filter bypass)
//   * only ports 80/443 (an internal Redis/Elasticsearch/admin port is never a
//     podcast enclosure)
//   * loopback, private, link-local, CGNAT, multicast, reserved and
//     documentation IP space is blocked, as are `localhost`, `*.localhost`,
//     `*.local`, `*.internal`, `*.home.arpa` and the cloud metadata names
//   * a hostname whose last label is numeric (`2130706433`, `0x7f000001`,
//     `127.1`) must parse as a public dotted quad, otherwise it is refused —
//     decimal/octal/hex IP literals are the other classic bypass
//   * IPv6 literals are allowed only inside global unicast 2000::/3, which
//     default-denies ::1, ::, fc00::/7, fe80::/10, ff00::/8 and ::ffff:-mapped
//     IPv4 in one rule — minus 2002::/16 (6to4, which smuggles an arbitrary
//     IPv4 such as 127.0.0.1 inside a global-looking address) and its relay
//     anycast prefix 192.88.99.0/24 (RFC 7526), both carved back out
// Every redirect hop is re-validated (a public host that 302s to 169.254.169.254
// is the whole attack), hops are capped, and every document we parse is capped
// in bytes and in wall-clock. Untrusted content is re-validated too: an
// enclosure URL out of a feed, a `feedUrl` out of the iTunes API and an
// `og:audio` out of a page are all just as attacker-controlled as the input.
//
// TEXT DECODING — feeds and episode pages are not all UTF-8. Self-hosted French
// publishers still serve ISO-8859-1/windows-1252, so we honour the charset the
// document declares (BOM, then HTTP `Content-Type`, then the XML declaration or
// `<meta charset>`) instead of assuming UTF-8 and shipping a job titled
// "�pisode 42" to the audience that reads French first.
//
// DURATION — the 90-minute cap is enforced BEFORE a provider is ever called,
// for every source, with no "we'll find out when the bill arrives" path. Three
// signals, in order of how much they know:
//   1. `<itunes:duration>` when a feed states it.
//   2. The container header itself. We range-GET the first 256 kB of the media
//      and read the length the encoder wrote there (MP3 Xing/CBR, MP4 `mvhd`,
//      WAV `fmt `/`data`, FLAC STREAMINFO) — see transcription-duration.ts.
//      This is the only honest number available before transcription.
//   3. A byte-derived LOWER BOUND for the containers whose head does not state a
//      length (Ogg/Opus put it in the last page, WebM needs an EBML walk): the
//      byte count over the highest bitrate that container can plausibly carry.
//      It can only prove a file is too long, never price it.
// A URL that declares no length at all (chunked, or a live stream) is refused:
// there is nothing to bound. The old single 750 kB/s ceiling only rejected past
// ~4 GB, i.e. it let a 100-hour 64 kbps file through as "provably fine".

import type { Env } from "../env";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  TranscriptionError,
  isTranscriptionError,
  type ClassifiedSource,
  type PodcastSourceHint,
  type ResolvedSource,
  type TranscriptionFailure,
  type TranscriptionSourceRef,
} from "./transcription/types";
import { minimumDurationSeconds, sniffContainerDuration } from "./transcription-duration";

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Redirect hops we will follow. Tracking prefixes chain 2-3 deep; 4 is plenty. */
const MAX_REDIRECTS = 4;
const FEED_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 8_000;
const LOOKUP_TIMEOUT_MS = 8_000;
/** A podcast feed with hundreds of episodes is ~1 MB of XML. 4 MB is generous. */
const MAX_FEED_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Feed items we will look at. Bounds regex work on a hostile document. */
const MAX_FEED_ITEMS = 300;
/**
 * How much of the media we read to find its duration. Every container we can
 * measure states its length in the first few kilobytes; 256 kB is enough to step
 * over a fat ID3 tag or cover art and still land on the first audio frame.
 */
const MEDIA_HEAD_BYTES = 256 * 1024;

const ITUNES_LOOKUP_ENDPOINT = "https://itunes.apple.com/lookup";

// ---------------------------------------------------------------------------
// Media types
// ---------------------------------------------------------------------------

/**
 * Extensions we accept, mapped to the content type we will declare when the
 * server does not. The first eight are the contract's list; `m4b`, `oga`,
 * `opus` and `mpga` are tolerated aliases of the same containers.
 */
const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  webm: "audio/webm",
  aac: "audio/aac",
};

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mpeg3",
  "audio/x-mpeg-3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/aacp",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
  "application/ogg",
  "audio/opus",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/**
 * Types that carry no information. Accepted only when the filename or path
 * already told us it is audio — a great many podcast CDNs serve exactly this.
 */
const OPAQUE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/download",
  "application/force-download",
  "application/x-download",
]);

// ---------------------------------------------------------------------------
// Host tables
// ---------------------------------------------------------------------------

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com", "yt.be"];
const SPOTIFY_HOSTS = ["spotify.com", "spotifycdn.com", "spotify.link"];
const APPLE_PODCAST_HOSTS = ["podcasts.apple.com", "itunes.apple.com", "podcast.apple.com"];

/** Hosts that publish RSS at paths with no `.xml`/`.rss` extension. */
const FEED_HOSTS = [
  "feeds.megaphone.fm",
  "feeds.buzzsprout.com",
  "feeds.simplecast.com",
  "feeds.acast.com",
  "feeds.libsyn.com",
  "feeds.captivate.fm",
  "feeds.transistor.fm",
  "feeds.redcircle.com",
  "feeds.soundcloud.com",
  "feed.podbean.com",
  "anchor.fm",
  "rss.com",
  "media.rss.com",
];

/** Podcast platforms whose pages are episode pages worth scraping. */
const EPISODE_PAGE_HOSTS = [
  "overcast.fm",
  "pca.st",
  "castbox.fm",
  "podbean.com",
  "buzzsprout.com",
  "simplecast.com",
  "acast.com",
  "ausha.co",
  "podcastaddict.com",
  "podcloud.fr",
  "radiofrance.fr",
  "franceculture.fr",
  "arteradio.com",
  "spreaker.com",
  "soundcloud.com",
  "transistor.fm",
  "captivate.fm",
  "redcircle.com",
  "podinstall.com",
];

/** Names that resolve inside a cloud provider, whatever the DNS answer says. */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".localdomain"];

const ALLOWED_PORTS: ReadonlySet<string> = new Set(["", "80", "443"]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function unsupported(detail: string): TranscriptionError {
  return new TranscriptionError({ code: "unsupported_source", detail });
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function hostMatchesAny(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostMatches(hostname, domain));
}

function extensionOf(pathOrName: string): string | null {
  const leaf = pathOrName.split("/").pop() ?? "";
  const match = /\.([a-z0-9]{1,5})$/i.exec(leaf);
  return match ? match[1].toLowerCase() : null;
}

function normaliseContentType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.split(";")[0].trim().toLowerCase();
  return value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

/** Strict dotted quad only — `127.1` and `0x7f.1` deliberately fail here. */
function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

function isBlockedIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 — "this host", and 0.0.0.0 itself
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast (RFC 7526)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * Default-deny for IPv6: only global unicast 2000::/3 is allowed, which refuses
 * ::1, ::, fc00::/7, fe80::/10, ff00::/8 and ::ffff:127.0.0.1 in a single rule.
 *
 * Three prefixes are then carved back OUT of that allowance, all for the same
 * reason — they wear a globally-routable-looking prefix over an address that is
 * really something else:
 *   * 2002::/16       6to4. Embeds an arbitrary IPv4 in its next two groups, so
 *                     `[2002:7f00:1::]` is 127.0.0.1 in disguise. The whole /16
 *                     goes rather than re-deriving the inner quad.
 *   * 2001:0::/32     Teredo. Embeds a server IPv4 and an obfuscated client
 *                     IPv4 exactly the same way — `[2001:0:4136:e378:8000:63bf:3fff:fdd2]`
 *                     is a tunnelled address, not a host we meant to allow.
 *   * 2001:db8::/32   Documentation space (RFC 3849). Never a real podcast host,
 *                     and allowing reserved ranges is how a guard rots.
 * The rest of 2001::/16 is ordinary global unicast and stays allowed.
 */
function isBlockedIpv6Literal(literal: string): boolean {
  const inner = literal.slice(1, -1).toLowerCase();
  const groups = inner.split(":");
  const firstGroup = groups[0];
  if (firstGroup === "") return true; // ::1, ::, ::ffff:a.b.c.d
  if (!/^[0-9a-f]{1,4}$/.test(firstGroup)) return true;
  const value = Number.parseInt(firstGroup, 16);
  if (value === 0x2002) return true; // 6to4 — an IPv4 in disguise
  if (value === 0x2001) {
    // An empty second group is a `::` zero-run, which is a zero second group.
    const second = groups.length > 1 ? groups[1] : "";
    if (second === "" || !/^[0-9a-f]{1,4}$/.test(second)) return true;
    const secondValue = Number.parseInt(second, 16);
    if (secondValue === 0x0000 || secondValue === 0x0db8) return true; // Teredo, docs
  }
  return value < 0x2000 || value > 0x3fff;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (host.length === 0) return true;
  if (host.startsWith("[")) return isBlockedIpv6Literal(host);
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const ipv4 = parseIpv4(host);
  if (ipv4) return isBlockedIpv4(ipv4);

  // A numeric or hex last label is never a real TLD: it is an IP literal in
  // disguise (decimal, octal, hex, or short form). Refuse the whole class.
  const lastLabel = host.split(".").pop() ?? "";
  if (/^(\d+|0[xX][0-9a-fA-F]+)$/.test(lastLabel)) return true;

  return false;
}

/**
 * Validate a candidate URL. Returns the parsed URL or the exact failure to show.
 * Shared by `classifySource` (which reports) and `assertSafeUrl` (which throws),
 * so a redirect hop can never be judged by looser rules than the pasted input.
 */
function inspectUrl(raw: string): { ok: true; url: URL } | { ok: false; failure: TranscriptionFailure } {
  const trimmed = raw.trim().replace(/^[<"']+/, "").replace(/[>"']+$/, "");
  if (trimmed.length === 0) return { ok: false, failure: { code: "unsupported_source", detail: "empty" } };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, failure: { code: "unsupported_source", detail: "not_a_url" } };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, failure: { code: "unsupported_source", detail: `scheme_${url.protocol.replace(":", "")}` } };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, failure: { code: "unsupported_source", detail: "credentials_in_url" } };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, failure: { code: "unsupported_source", detail: "blocked_port" } };
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false, failure: { code: "unsupported_source", detail: "blocked_host" } };
  }
  return { ok: true, url };
}

/** Throwing form, for every URL we are about to fetch — including redirects. */
export function assertSafeUrl(raw: string): URL {
  const inspected = inspectUrl(raw);
  if (!inspected.ok) throw new TranscriptionError(inspected.failure);
  return inspected.url;
}

// ---------------------------------------------------------------------------
// classifySource
// ---------------------------------------------------------------------------

function looksLikeFeedUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  if (/\.(rss|xml|atom)$/.test(path)) return true;
  if (/(^|\/)(rss|feed|feeds|atom)(\/|$)/.test(path)) return true;
  if (path.includes("/podcast/rss") || path.includes("format=rss")) return true;
  if (hostMatchesAny(url.hostname.toLowerCase(), FEED_HOSTS)) return true;
  const type = url.searchParams.get("format")?.toLowerCase();
  return type === "rss" || type === "xml";
}

function looksLikeEpisodePage(url: URL): boolean {
  if (hostMatchesAny(url.hostname.toLowerCase(), EPISODE_PAGE_HOSTS)) return true;
  const path = url.pathname.toLowerCase();
  return /(^|\/)(episode|episodes|ep|podcast|podcasts|emission|emissions|listen|ecouter)(\/|-|$)/.test(path);
}

function unsupportedClassification(url: string | null, failure: TranscriptionFailure): ClassifiedSource {
  return { kind: "direct_url", url, supported: false, failure, podcastHint: null };
}

/**
 * What did the teacher paste? Pure and synchronous — no network, no fetch, so a
 * route can classify before it commits to anything.
 *
 * A bare `example.com/x.mp3` (no scheme) is read as https, because teachers copy
 * URLs out of address bars that hide the scheme. Anything we cannot honour comes
 * back with `supported: false` and a code the UI translates; the copy for
 * `unsupported_source` is where the list of supported inputs lives.
 */
export function classifySource(input: string): ClassifiedSource {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return unsupportedClassification(null, { code: "unsupported_source", detail: "empty" });
  }

  // Scheme-less but clearly a host: teachers paste what the address bar shows.
  const candidate = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

  const inspected = inspectUrl(candidate);

  // Recognise the two platforms BEFORE the SSRF verdict so a teacher pasting a
  // YouTube link never sees a generic "unsupported" message.
  let hostname: string | null = null;
  try {
    hostname = new URL(candidate).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    hostname = null;
  }
  if (hostname && hostMatchesAny(hostname, YOUTUBE_HOSTS)) {
    return {
      kind: "youtube",
      url: candidate,
      supported: false,
      failure: { code: "youtube_not_yet_supported", url: candidate },
      podcastHint: null,
    };
  }
  if (hostname && hostMatchesAny(hostname, SPOTIFY_HOSTS)) {
    return {
      kind: "podcast",
      url: candidate,
      supported: false,
      failure: { code: "spotify_not_supported", url: candidate },
      podcastHint: "generic",
    };
  }

  if (!inspected.ok) return unsupportedClassification(candidate, inspected.failure);
  const url = inspected.url;
  const host = url.hostname.toLowerCase();

  if (hostMatchesAny(host, APPLE_PODCAST_HOSTS)) {
    const ids = applePodcastIds(url);
    if (!ids.showId && !ids.episodeId) {
      return unsupportedClassification(url.toString(), { code: "unsupported_source", detail: "apple_no_id" });
    }
    return { kind: "podcast", url: url.toString(), supported: true, failure: null, podcastHint: "apple" };
  }

  const extension = extensionOf(url.pathname);
  if (extension && extension in EXTENSION_CONTENT_TYPES) {
    return { kind: "direct_url", url: url.toString(), supported: true, failure: null, podcastHint: null };
  }

  const hint: PodcastSourceHint | null = looksLikeFeedUrl(url)
    ? "rss"
    : looksLikeEpisodePage(url)
      ? "episode_page"
      : null;

  if (hint) {
    return { kind: "podcast", url: url.toString(), supported: true, failure: null, podcastHint: hint };
  }

  return unsupportedClassification(url.toString(), { code: "unsupported_source", detail: "unrecognised_url" });
}

// ---------------------------------------------------------------------------
// Feed + page parsing (pure)
// ---------------------------------------------------------------------------

export interface PodcastEpisode {
  title: string | null;
  /** The `<enclosure url>` — the same URL every podcast app plays. */
  audioUrl: string;
  contentType: string | null;
  bytes: number | null;
  /** From `<itunes:duration>`, when the publisher stated it. */
  durationSeconds: number | null;
  publishedAt: string | null;
  guid: string | null;
}

export interface PodcastFeed {
  feedUrl: string;
  title: string | null;
  /** In document order — which many feeds publish oldest-first. Not a ranking. */
  episodes: PodcastEpisode[];
}

function safeCodePoint(value: number): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
}

/** CDATA out, tags out, entities decoded. `&amp;` last so `&amp;lt;` survives. */
function decodeXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match: string, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match: string, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * One attribute out of one tag.
 *
 * The name must begin at a REAL attribute boundary — the start of the string,
 * whitespace, a `/`, or the quote that closed the previous value. A plain `\b`
 * also matches between `-` and a letter, so `data-src` satisfied a search for
 * `src`, `data-type` satisfied `type`, `data-url` satisfied `url`. Since the
 * first match in the tag wins, a prefixed attribute silently beat the real one:
 *   - `<audio data-src="…lowres…" src="…real…">` — the ordinary lazy-loading
 *     pattern — resolved to the decoy, so we transcribed and billed a file the
 *     teacher never asked for;
 *   - `<enclosure url="…" data-type="image/jpeg" type="audio/mpeg"/>` read as an
 *     image, which emptied the episode list and told a teacher their own
 *     podcast had no audio.
 *
 * Unquoted values are legal HTML5 (`<audio src=https://cdn/ep.mp3>`) and used to
 * come back null, losing the audio entirely, so they are read too. The lazy
 * capture stops before a `/>` so an XHTML self-closing marker never lands inside
 * the URL; a trailing slash the author actually wrote (`href=/feed/ `) is kept.
 */
function attribute(tag: string, name: string): string | null {
  const value = `"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+?)(?=\\/?>|\\s|$)`;
  const match = new RegExp(`(?:^|[\\s"'/])${name}\\s*=\\s*(?:${value})`, "i").exec(tag);
  if (!match) return null;
  return decodeXmlText(match[1] ?? match[2] ?? match[3] ?? "") || null;
}

function firstTagText(xml: string, names: readonly string[]): string | null {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
    if (match) {
      const text = decodeXmlText(match[1]);
      if (text.length > 0) return text;
    }
  }
  return null;
}

/** `"3600"`, `"12:34"` and `"1:02:03"` are all in the wild. */
export function parseItunesDuration(raw: string | null): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  const parts = value.split(":");
  if (parts.some((part) => !/^\d+(\.\d+)?$/.test(part.trim()))) return null;
  const numbers = parts.map((part) => Number.parseFloat(part));
  let seconds: number;
  if (numbers.length === 1) seconds = numbers[0];
  else if (numbers.length === 2) seconds = numbers[0] * 60 + numbers[1];
  else if (numbers.length === 3) seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  else return null;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

function parseByteLength(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface ItemEnclosure {
  url: string;
  contentType: string | null;
  bytes: number | null;
}

/** The path part of an enclosure URL, so a query string cannot fake an extension. */
function mediaPath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return rawUrl.split("#")[0].split("?")[0];
  }
}

/**
 * What the feed itself tells us about one media candidate — no network:
 *   `audio`      the declared type is one we accept, or the path ends in an
 *                audio extension we accept
 *   `unknown`    nothing rules it out: no type (or an opaque CDN one) and no
 *                extension at all, so only the probe can decide
 *   `not_audio`  the feed says this is a cover image, a PDF transcript or a web
 *                page, or the path carries a non-audio extension
 *
 * Same three tables as `resolveMediaContentType`, deliberately: an item we keep
 * must be an item that could still pass. `unknown` is kept rather than dropped
 * because a great many CDNs publish extension-less, type-less enclosures, and
 * dropping those would tell a teacher their own podcast is not audio.
 */
function enclosureVerdict(candidate: ItemEnclosure): "audio" | "unknown" | "not_audio" {
  const declared = candidate.contentType;
  if (declared !== null) {
    if (ALLOWED_CONTENT_TYPES.has(declared)) return "audio";
    if (!OPAQUE_CONTENT_TYPES.has(declared)) return "not_audio";
  }
  const extension = extensionOf(mediaPath(candidate.url));
  if (extension === null) return "unknown";
  return extension in EXTENSION_CONTENT_TYPES ? "audio" : "not_audio";
}

/** Every media candidate in one item, in descending order of trust. */
function itemEnclosureCandidates(itemXml: string): ItemEnclosure[] {
  const candidates: ItemEnclosure[] = [];

  for (const tag of itemXml.match(/<enclosure\b[^>]*>/gi) ?? []) {
    const url = attribute(tag, "url");
    if (url) {
      candidates.push({
        url,
        contentType: normaliseContentType(attribute(tag, "type")),
        bytes: parseByteLength(attribute(tag, "length")),
      });
    }
  }

  for (const tag of itemXml.match(/<link\b[^>]*>/gi) ?? []) {
    if (attribute(tag, "rel")?.toLowerCase() !== "enclosure") continue;
    const url = attribute(tag, "href");
    if (url) {
      candidates.push({
        url,
        contentType: normaliseContentType(attribute(tag, "type")),
        bytes: parseByteLength(attribute(tag, "length")),
      });
    }
  }

  for (const tag of itemXml.match(/<media:content\b[^>]*>/gi) ?? []) {
    const url = attribute(tag, "url");
    if (url) {
      candidates.push({
        url,
        contentType: normaliseContentType(attribute(tag, "type")),
        bytes: parseByteLength(attribute(tag, "fileSize")),
      });
    }
  }

  return candidates;
}

/**
 * The audio of one `<item>`/`<entry>`: RSS `<enclosure>`, Atom
 * `<link rel="enclosure">`, then `<media:content>`.
 *
 * All candidates are weighed, not just the first one, because an item routinely
 * carries media that is not the episode — a cover image in `<media:content>`, a
 * PDF transcript in a second `<enclosure>`. Taking the first tag we found would
 * hand that to the provider and kill an item whose real mp3 sits one tag later.
 * Returns null when the item has no audio at all (a text-only post, an
 * announcement, a chapter-marker item).
 */
function itemEnclosure(itemXml: string): ItemEnclosure | null {
  const candidates = itemEnclosureCandidates(itemXml);
  return (
    candidates.find((candidate) => enclosureVerdict(candidate) === "audio") ??
    candidates.find((candidate) => enclosureVerdict(candidate) === "unknown") ??
    null
  );
}

/**
 * Regex-based on purpose: the Workers runtime has no XML parser, and a feed is
 * hostile input we only ever want four fields out of. Items with no enclosure —
 * and items whose only media the feed itself declares as an image, a PDF or a
 * page — are dropped: they are not transcribable, they must not appear in a
 * picker, and they must never become the episode we bill a teacher for.
 *
 * Episodes come back in document order, which is NOT chronological order: see
 * `newestEpisode` for why nothing may assume item 1 is the latest episode.
 */
export function parsePodcastFeed(xml: string, feedUrl: string): PodcastFeed {
  const head = xml.split(/<item(?:\s|>)|<entry(?:\s|>)/i)[0];
  const feedTitle = firstTagText(head, ["title"]);

  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  const episodes: PodcastEpisode[] = [];

  for (const block of blocks.slice(0, MAX_FEED_ITEMS)) {
    const enclosure = itemEnclosure(block);
    if (!enclosure) continue;
    episodes.push({
      title: firstTagText(block, ["title"]),
      audioUrl: enclosure.url,
      contentType: enclosure.contentType,
      bytes: enclosure.bytes,
      durationSeconds: parseItunesDuration(firstTagText(block, ["itunes:duration", "duration"])),
      publishedAt: firstTagText(block, ["pubDate", "published", "updated"]),
      guid: firstTagText(block, ["guid", "id"]),
    });
  }

  return { feedUrl, title: feedTitle, episodes };
}

function looksLikeFeedDocument(body: string): boolean {
  const head = body.slice(0, 2000).toLowerCase();
  return head.includes("<rss") || head.includes("<feed") || head.includes("<channel");
}

/**
 * Audio on an episode page, in order of trustworthiness: the publisher's own
 * `og:audio`, a player stream, then a plain `<audio>`/`<source>` element. We
 * never guess from arbitrary links — a wrong episode costs a teacher real quota.
 */
export function scrapeEpisodePage(
  html: string,
  pageUrl: string
): { audioUrl: string | null; feedUrl: string | null; title: string | null } {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  /**
   * Name order IS the priority order, so the outer loop must be over `names`,
   * not over the document. Iterating the document first would hand a page that
   * emits a decoy `<meta name="audio">` above its canonical `og:audio:secure_url`
   * the decoy — a file the teacher never asked for, transcribed and billed.
   */
  const metaValue = (names: readonly string[]): string | null => {
    for (const name of names) {
      for (const tag of metaTags) {
        const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? "").toLowerCase();
        if (key !== name) continue;
        const content = attribute(tag, "content");
        if (content) return content;
      }
    }
    return null;
  };

  let audioUrl =
    metaValue(["og:audio:secure_url", "og:audio", "twitter:player:stream", "audio"]) ?? null;

  if (!audioUrl) {
    const elements = html.match(/<(audio|source)\b[^>]*>/gi) ?? [];
    for (const tag of elements) {
      const src = attribute(tag, "src");
      if (!src) continue;
      const type = normaliseContentType(attribute(tag, "type"));
      const extension = extensionOf(src.split("?")[0]);
      const usable = (type !== null && ALLOWED_CONTENT_TYPES.has(type)) || (extension !== null && extension in EXTENSION_CONTENT_TYPES);
      if (usable) {
        audioUrl = src;
        break;
      }
    }
  }

  let feedUrl: string | null = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const type = normaliseContentType(attribute(tag, "type"));
    if (type !== "application/rss+xml" && type !== "application/atom+xml") continue;
    const href = attribute(tag, "href");
    if (href) {
      feedUrl = href;
      break;
    }
  }

  const absolute = (value: string | null): string | null => {
    if (!value) return null;
    try {
      return new URL(value, pageUrl).toString();
    } catch {
      return null;
    }
  };

  return {
    audioUrl: absolute(audioUrl),
    feedUrl: absolute(feedUrl),
    title: metaValue(["og:title"]) ?? firstTagText(html, ["title"]),
  };
}

// ---------------------------------------------------------------------------
// Guarded fetching
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A cancelled body we cannot cancel is not worth failing a job over.
  }
}

/**
 * Fetch with manual redirects, re-validating EVERY hop. The whole SSRF attack is
 * a public host answering 302 with `Location: http://169.254.169.254/…`, so the
 * automatic redirect follower is never acceptable here.
 *
 * ONE signal for the whole chain, not one per hop: a fresh
 * `AbortSignal.timeout` per hop meant five cooperating redirects could hold a
 * queue consumer for five times the stated budget. The timeout is a deadline for
 * the fetch, not an allowance each hop gets to spend again.
 */
async function guardedFetch(
  target: URL,
  fetcher: typeof fetch,
  init: { method: "GET" | "HEAD"; headers?: Record<string, string>; timeoutMs: number }
): Promise<{ response: Response; finalUrl: URL }> {
  let url = target;
  const signal = AbortSignal.timeout(init.timeoutMs);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetcher(url.toString(), {
        method: init.method,
        headers: { "user-agent": "TeachInspire-Transcription/1.0", ...init.headers },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (isTranscriptionError(error)) throw error;
      throw new TranscriptionError({ code: "source_unreachable" });
    }

    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: url };

    const location = response.headers.get("location");
    await discard(response);
    if (!location) throw new TranscriptionError({ code: "source_unreachable", status: response.status });

    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      throw unsupported("bad_redirect_location");
    }
    url = assertSafeUrl(next);
  }
  // A chain longer than this is a loop or a cloaking attempt, not a CDN.
  throw new TranscriptionError({ code: "source_unreachable" });
}

// ---------------------------------------------------------------------------
// Text decoding
// ---------------------------------------------------------------------------

const UTF8_LABELS: ReadonlySet<string> = new Set(["utf-8", "utf8", "unicode-1-1-utf-8", "csutf8"]);

/**
 * Labels the WHATWG Encoding Standard decodes with the windows-1252 table —
 * including every `iso-8859-1` and `ascii` spelling, which real feeds use
 * interchangeably even when they mean cp1252.
 */
const WINDOWS_1252_LABELS: ReadonlySet<string> = new Set([
  "windows-1252",
  "cp1252",
  "x-cp1252",
  "iso-8859-1",
  "iso8859-1",
  "iso_8859-1",
  "iso-ir-100",
  "latin1",
  "l1",
  "ascii",
  "us-ascii",
  "ansi_x3.4-1968",
]);

/** The 0x80–0x9F rows where windows-1252 differs from Latin-1. */
const WINDOWS_1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/**
 * Hand-rolled because it must never depend on which optional encodings the
 * runtime shipped: workerd and Node disagree about the legacy tables, and a
 * French title is not something to leave to a `RangeError`.
 */
function decodeWindows1252(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += String.fromCharCode(byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80] : byte);
  }
  return out;
}

function charsetFromContentType(raw: string | null): string | null {
  if (!raw) return null;
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(raw);
  return match ? match[1].trim().toLowerCase() : null;
}

/** A byte-exact ASCII view of the head, enough to read a declaration out of it. */
function asciiHead(bytes: Uint8Array, limit = 1024): string {
  let out = "";
  for (const byte of bytes.subarray(0, limit)) out += String.fromCharCode(byte);
  return out;
}

/** `<?xml … encoding="…"?>` first, then `<meta charset>` / `<meta http-equiv>`. */
function charsetFromDocumentHead(bytes: Uint8Array): string | null {
  const head = asciiHead(bytes);
  const xmlDeclaration = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (xmlDeclaration) return xmlDeclaration[1].trim().toLowerCase();
  const meta = /<meta\b[^>]*charset\s*=\s*["']?([a-z0-9_:.-]+)/i.exec(head);
  return meta ? meta[1].trim().toLowerCase() : null;
}

/** A BOM outranks every declaration — it is the bytes speaking for themselves. */
function charsetFromBom(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

/**
 * Decode a fetched document with the charset it actually declared. UTF-8 stays
 * the default — it is what modern publishers serve — but a feed that says
 * ISO-8859-1 is read as ISO-8859-1 rather than turned into replacement
 * characters inside the episode title we put on the job.
 */
function decodeDocument(bytes: Uint8Array, contentTypeHeader: string | null): string {
  const label = charsetFromBom(bytes) ?? charsetFromContentType(contentTypeHeader) ?? charsetFromDocumentHead(bytes);
  if (label === null || UTF8_LABELS.has(label)) return new TextDecoder("utf-8").decode(bytes);
  if (WINDOWS_1252_LABELS.has(label)) return decodeWindows1252(bytes);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // An encoding this runtime does not know. UTF-8 is the least-wrong guess.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Read a body with a hard byte ceiling — a hostile "feed" can be endless. */
async function readCappedText(response: Response, maxBytes: number, what: string): Promise<string> {
  const declared = parseByteLength(response.headers.get("content-length"));
  if (declared !== null && declared > maxBytes) {
    await discard(response);
    throw unsupported(`${what}_too_large`);
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw unsupported(`${what}_too_large`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeDocument(merged, response.headers.get("content-type"));
}

async function fetchDocument(
  url: URL,
  fetcher: typeof fetch,
  options: { maxBytes: number; accept: string; what: string }
): Promise<{ body: string; finalUrl: URL }> {
  const { response, finalUrl } = await guardedFetch(url, fetcher, {
    method: "GET",
    headers: { accept: options.accept },
    timeoutMs: FEED_TIMEOUT_MS,
  });
  if (!response.ok) {
    await discard(response);
    throw new TranscriptionError({ code: "source_unreachable", status: response.status });
  }
  return { body: await readCappedText(response, options.maxBytes, options.what), finalUrl };
}

function totalBytesFromHeaders(headers: Headers): number | null {
  const range = headers.get("content-range");
  if (range) {
    const match = /\/(\d+)\s*$/.exec(range);
    if (match) return parseByteLength(match[1]);
  }
  return parseByteLength(headers.get("content-length"));
}

/** Read at most `maxBytes` and hang up. Ignores content-length: a server that
 *  ignored our Range header answers 200 with the whole file, and cancelling the
 *  body after the head is exactly how we avoid downloading it. */
async function readHeadBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.length) break;
    merged.set(chunk.subarray(0, merged.length - offset), offset);
    offset += chunk.byteLength;
  }
  return merged;
}

interface MediaProbe {
  finalUrl: URL;
  contentType: string | null;
  bytes: number | null;
  /** The container's first bytes, or null when the server would not serve them. */
  head: Uint8Array | null;
}

/**
 * The whole file's length as this response describes it.
 *
 * On a 206, `content-length` is the size of the PART we asked for — 256 kB — so
 * trusting it would report every ranged source as a quarter-megabyte and make the
 * byte bound meaningless. Only `content-range`'s total may be believed there. On
 * a 200 the body is the whole file, so `content-length` is the file.
 */
function probeTotalBytes(response: Response): number | null {
  if (response.status === 206) {
    const range = response.headers.get("content-range");
    const match = range ? /\/(\d+)\s*$/.exec(range) : null;
    return match ? parseByteLength(match[1]) : null;
  }
  return totalBytesFromHeaders(response.headers);
}

/**
 * Confirm the media is really there, learn its type and size, and bring back the
 * container header we derive the duration from.
 *
 * A ranged GET goes FIRST, not a HEAD, and it asks for the first 256 kB rather
 * than the first byte: one round trip then yields the content type, the total
 * length (via `content-range`, or `content-length` from a server that ignored
 * the range) and the bytes that state the duration. HEAD is the fallback for the
 * CDNs that refuse ranged GETs — it still gives type and size, and we fall back
 * to the byte-derived bound for the length.
 */
async function probeMedia(url: URL, fetcher: typeof fetch): Promise<MediaProbe> {
  const ranged = await guardedFetch(url, fetcher, {
    method: "GET",
    headers: { range: `bytes=0-${MEDIA_HEAD_BYTES - 1}` },
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (ranged.response.ok) {
    const bytes = probeTotalBytes(ranged.response);
    const head = await readHeadBytes(ranged.response, MEDIA_HEAD_BYTES);
    return {
      finalUrl: ranged.finalUrl,
      contentType: normaliseContentType(ranged.response.headers.get("content-type")),
      bytes,
      head,
    };
  }
  await discard(ranged.response);

  const head = await guardedFetch(url, fetcher, { method: "HEAD", timeoutMs: PROBE_TIMEOUT_MS });
  await discard(head.response);
  if (!head.response.ok) {
    throw new TranscriptionError({ code: "source_unreachable", status: head.response.status });
  }
  return {
    finalUrl: head.finalUrl,
    contentType: normaliseContentType(head.response.headers.get("content-type")),
    bytes: totalBytesFromHeaders(head.response.headers),
    head: null,
  };
}

// ---------------------------------------------------------------------------
// Early caps
// ---------------------------------------------------------------------------

function tooLong(durationSeconds: number): TranscriptionError {
  return new TranscriptionError({
    code: "source_too_long",
    durationSeconds: Math.ceil(durationSeconds),
    maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
  });
}

function assertWithinDurationCap(durationSeconds: number | null): void {
  if (durationSeconds === null) return;
  if (durationSeconds > TRANSCRIPTION_MAX_SOURCE_SECONDS) throw tooLong(durationSeconds);
}

/**
 * THE duration gate. Nothing reaches a provider without passing through here.
 *
 * Returns the best length we know, which the job row records and the provider
 * ceiling check re-uses. Billing never uses it — that is always what the
 * provider measured — so a number that is too SMALL costs nothing, while a
 * number that is too LARGE would refuse a teacher's real lecture. Every source
 * below is therefore conservative in that direction.
 *
 * Order matters:
 *   1. A stated duration (a feed's `<itunes:duration>`) is checked first: it is
 *      free and it is the publisher's own claim.
 *   2. The container header is the authoritative measurement. If it says the
 *      media is over the cap we refuse, whatever the feed claimed — a feed that
 *      understates a six-hour file is exactly the case that used to get billed.
 *   3. Otherwise the byte-derived lower bound has to carry it. `null` bytes mean
 *      an unbounded stream: there is no length to check, so we refuse rather
 *      than submit something that could run for hours.
 */
function resolveDurationWithinCap(input: {
  statedSeconds: number | null;
  contentType: string | null;
  bytes: number | null;
  head: Uint8Array | null;
  /** Uploads always know their size; a URL that does not is a live stream. */
  requireKnownLength: boolean;
}): number | null {
  assertWithinDurationCap(input.statedSeconds);

  const sniffed = input.head === null ? null : sniffContainerDuration(input.head, input.bytes);
  if (sniffed !== null) {
    if (sniffed.seconds > TRANSCRIPTION_MAX_SOURCE_SECONDS) throw tooLong(sniffed.seconds);
    return sniffed.seconds;
  }

  const lowerBound = minimumDurationSeconds(input.contentType, input.bytes);
  if (lowerBound === null) {
    if (input.requireKnownLength) {
      // No content-length and no readable container: a chunked response or a
      // live stream. We cannot promise a 90-minute ceiling on something with no
      // end, so it is not a supported source.
      throw unsupported("unknown_length");
    }
    return input.statedSeconds;
  }
  if (lowerBound > TRANSCRIPTION_MAX_SOURCE_SECONDS) throw tooLong(lowerBound);

  return input.statedSeconds;
}

/**
 * Decide the content type we will declare, or refuse the media. A server type we
 * recognise wins; an opaque type is accepted when the path/filename says audio;
 * an HTML page pretending to be an enclosure is refused.
 */
function resolveMediaContentType(pathOrName: string, headerType: string | null): string {
  const declared = normaliseContentType(headerType);
  if (declared && ALLOWED_CONTENT_TYPES.has(declared)) return declared;

  const extension = extensionOf(pathOrName.split("?")[0]);
  const fromExtension = extension ? EXTENSION_CONTENT_TYPES[extension] : undefined;

  if (declared === null || OPAQUE_CONTENT_TYPES.has(declared)) {
    if (fromExtension) return fromExtension;
    throw new TranscriptionError({
      code: "unsupported_media_type",
      contentType: declared ?? undefined,
    });
  }

  // The server states something we do not accept. Trust it over the extension:
  // `text/html` with a `.mp3` path is a paywall or an error page, not audio.
  throw new TranscriptionError({ code: "unsupported_media_type", contentType: declared });
}

function titleFromUrl(url: URL): string | null {
  const leaf = url.pathname.split("/").filter(Boolean).pop();
  if (!leaf) return null;
  try {
    return decodeURIComponent(leaf).replace(/\.[a-z0-9]{1,5}$/i, "") || null;
  } catch {
    return leaf;
  }
}

// ---------------------------------------------------------------------------
// Apple Podcasts
// ---------------------------------------------------------------------------

function applePodcastIds(url: URL): { showId: string | null; episodeId: string | null } {
  const fromPath = /\/id(\d+)/.exec(url.pathname);
  const episodeParam = url.searchParams.get("i");
  return {
    showId: fromPath ? fromPath[1] : null,
    episodeId: episodeParam && /^\d+$/.test(episodeParam) ? episodeParam : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** First result of an iTunes Lookup response, narrowed by hand — no `any`. */
async function itunesLookup(
  params: Record<string, string>,
  fetcher: typeof fetch
): Promise<Record<string, unknown> | null> {
  const url = new URL(ITUNES_LOOKUP_ENDPOINT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  // Through `guardedFetch` like every other fetch in this module. The host is a
  // hardcoded constant today, so nothing is exploitable — but this was the one
  // call that followed redirects with the runtime's own follower and skipped
  // `assertSafeUrl` on the hops, and an exception is how a guard stops being one.
  const { response } = await guardedFetch(assertSafeUrl(url.toString()), fetcher, {
    method: "GET",
    headers: { accept: "application/json" },
    timeoutMs: LOOKUP_TIMEOUT_MS,
  });
  if (!response.ok) {
    await discard(response);
    throw new TranscriptionError({ code: "source_unreachable", status: response.status });
  }

  const text = await readCappedText(response, MAX_PAGE_BYTES, "lookup");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TranscriptionError({ code: "no_audio_found", detail: "apple_lookup_unreadable" });
  }
  const envelope = asRecord(parsed);
  const results = envelope && Array.isArray(envelope.results) ? envelope.results : [];
  return results.length > 0 ? asRecord(results[0]) : null;
}

// ---------------------------------------------------------------------------
// Podcast resolution
// ---------------------------------------------------------------------------

/** RFC 822 (`Tue, 05 Aug 2026 06:00:00 +0000`) and ISO 8601 both parse here. */
function parseFeedDate(raw: string | null): number | null {
  if (!raw) return null;
  const value = Date.parse(raw.trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * The newest episode by the date the publisher stated for it.
 *
 * Nothing in RSS or Atom requires items to be ordered, and chronological
 * (oldest-first) feeds are common — plenty of generators emit them, and a
 * hand-written feed usually appends. Trusting item 1 therefore transcribes a
 * years-old episode and spends the teacher's ledger seconds on it, with a title
 * on the job row as the only clue. So the dates decide.
 *
 * Document order is the fallback, not the rule: it is used only when no item
 * states a date we can parse. An undated item never wins on position alone —
 * there is nothing to compare it with.
 */
function newestEpisode(episodes: readonly PodcastEpisode[]): PodcastEpisode | null {
  let newest: PodcastEpisode | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const episode of episodes) {
    const publishedAt = parseFeedDate(episode.publishedAt);
    if (publishedAt === null || publishedAt <= newestAt) continue;
    newest = episode;
    newestAt = publishedAt;
  }
  return newest ?? episodes[0] ?? null;
}

function pickEpisode(feed: PodcastFeed, guid: string | null): PodcastEpisode {
  if (guid) {
    // An explicit guid is the teacher's own choice — it outranks every date.
    const matched = feed.episodes.find((episode) => episode.guid === guid);
    if (matched) return matched;
  }
  // The job title carries this episode's name, so the teacher can see what we took.
  const latest = newestEpisode(feed.episodes);
  if (!latest) throw new TranscriptionError({ code: "no_audio_found", detail: "feed_has_no_enclosure" });
  return latest;
}

async function fetchFeed(url: URL, fetcher: typeof fetch): Promise<PodcastFeed> {
  const { body, finalUrl } = await fetchDocument(url, fetcher, {
    maxBytes: MAX_FEED_BYTES,
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
    what: "feed",
  });
  if (!looksLikeFeedDocument(body)) {
    throw new TranscriptionError({ code: "no_audio_found", detail: "not_a_feed" });
  }
  return parsePodcastFeed(body, finalUrl.toString());
}

/**
 * The feed behind an Apple Podcasts link, plus the episode guid when the link
 * named one (`?i=<episodeId>`). Uses the official iTunes Lookup API — Apple has
 * no scrapeable audio and the lookup is the documented, stable path.
 */
async function resolveAppleLink(
  url: URL,
  fetcher: typeof fetch
): Promise<{ audioUrl: string | null; feedUrl: string | null; guid: string | null; title: string | null }> {
  const { showId, episodeId } = applePodcastIds(url);

  if (episodeId) {
    const episode = await itunesLookup({ id: episodeId, entity: "podcastEpisode" }, fetcher);
    if (episode) {
      return {
        // `episodeUrl` is Apple's copy of the RSS enclosure — the direct audio.
        audioUrl: asString(episode.episodeUrl),
        feedUrl: asString(episode.feedUrl),
        guid: asString(episode.episodeGuid),
        title: asString(episode.trackName),
      };
    }
  }

  if (showId) {
    const show = await itunesLookup({ id: showId, entity: "podcast" }, fetcher);
    if (show) {
      return {
        audioUrl: null,
        feedUrl: asString(show.feedUrl),
        guid: null,
        title: asString(show.collectionName),
      };
    }
  }

  throw new TranscriptionError({ code: "no_audio_found", detail: "apple_lookup_empty" });
}

interface PodcastTarget {
  audioUrl: URL;
  title: string | null;
  durationSeconds: number | null;
  contentType: string | null;
  bytes: number | null;
}

async function resolvePodcastTarget(
  input: string,
  hint: PodcastSourceHint,
  fetcher: typeof fetch
): Promise<PodcastTarget> {
  const start = assertSafeUrl(input);

  if (hint === "apple") {
    const apple = await resolveAppleLink(start, fetcher);
    if (apple.audioUrl) {
      return {
        audioUrl: assertSafeUrl(apple.audioUrl),
        title: apple.title,
        durationSeconds: null,
        contentType: null,
        bytes: null,
      };
    }
    if (!apple.feedUrl) throw new TranscriptionError({ code: "no_audio_found", detail: "apple_no_feed" });
    const feed = await fetchFeed(assertSafeUrl(apple.feedUrl), fetcher);
    const episode = pickEpisode(feed, apple.guid);
    return {
      audioUrl: assertSafeUrl(episode.audioUrl),
      title: episode.title ?? apple.title,
      durationSeconds: episode.durationSeconds,
      contentType: episode.contentType,
      bytes: episode.bytes,
    };
  }

  // RSS or an episode page — we cannot always tell from the URL, so look at what
  // actually came back rather than trusting the heuristic.
  const { body, finalUrl } = await fetchDocument(start, fetcher, {
    maxBytes: MAX_FEED_BYTES,
    accept: "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.5",
    what: "feed",
  });

  if (looksLikeFeedDocument(body)) {
    const feed = parsePodcastFeed(body, finalUrl.toString());
    const episode = pickEpisode(feed, null);
    return {
      audioUrl: assertSafeUrl(episode.audioUrl),
      title: episode.title ?? feed.title,
      durationSeconds: episode.durationSeconds,
      contentType: episode.contentType,
      bytes: episode.bytes,
    };
  }

  const page = scrapeEpisodePage(body, finalUrl.toString());
  if (page.audioUrl) {
    return {
      audioUrl: assertSafeUrl(page.audioUrl),
      title: page.title,
      durationSeconds: null,
      contentType: null,
      bytes: null,
    };
  }
  if (page.feedUrl) {
    const feed = await fetchFeed(assertSafeUrl(page.feedUrl), fetcher);
    const episode = pickEpisode(feed, null);
    return {
      audioUrl: assertSafeUrl(episode.audioUrl),
      title: episode.title ?? page.title,
      durationSeconds: episode.durationSeconds,
      contentType: episode.contentType,
      bytes: episode.bytes,
    };
  }
  throw new TranscriptionError({ code: "no_audio_found", detail: "page_has_no_audio" });
}

/**
 * The episode list behind a feed or an Apple Podcasts link, so the UI offers a
 * picker instead of silently assuming the latest episode. `resolveSource`
 * returns exactly one media item by contract, so choosing an episode is a
 * separate, read-only step: the teacher picks, and the chosen `audioUrl` is
 * submitted as an ordinary `direct_url` job.
 *
 * Exposed as `POST /api/transcriptions/episodes`. It never probes or bills any
 * media, so it costs the quota ledger nothing — which is exactly why that route
 * is rate-limited per minute instead: it is still an outbound fetch on demand.
 *
 * A feed this cannot read is not a dead end. The page falls through to a normal
 * submission and lets `resolveSource` try, so our own parsing is never the
 * reason a teacher is blocked.
 */
export async function listPodcastEpisodes(
  _env: Env,
  input: string,
  fetcher: typeof fetch = fetch
): Promise<PodcastFeed> {
  const classified = classifySource(input);
  if (!classified.supported || classified.url === null) {
    throw new TranscriptionError(classified.failure ?? { code: "unsupported_source" });
  }
  if (classified.kind !== "podcast") throw unsupported("not_a_podcast_url");

  if (classified.podcastHint === "apple") {
    const apple = await resolveAppleLink(assertSafeUrl(classified.url), fetcher);
    if (!apple.feedUrl) throw new TranscriptionError({ code: "no_audio_found", detail: "apple_no_feed" });
    return fetchFeed(assertSafeUrl(apple.feedUrl), fetcher);
  }

  const { body, finalUrl } = await fetchDocument(assertSafeUrl(classified.url), fetcher, {
    maxBytes: MAX_FEED_BYTES,
    accept: "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.5",
    what: "feed",
  });
  if (looksLikeFeedDocument(body)) return parsePodcastFeed(body, finalUrl.toString());

  const page = scrapeEpisodePage(body, finalUrl.toString());
  if (page.feedUrl) return fetchFeed(assertSafeUrl(page.feedUrl), fetcher);
  throw new TranscriptionError({ code: "no_audio_found", detail: "no_feed_on_page" });
}

// ---------------------------------------------------------------------------
// resolveSource
// ---------------------------------------------------------------------------

/**
 * An uploaded file. Read TWICE from R2, deliberately: once ranged, for the
 * container header the duration gate needs, and once in full for the media we
 * hand the provider. An R2 read is cheap; submitting a six-hour file because we
 * could not be bothered to look at its header is not.
 *
 * The media itself becomes a `Blob` and stays one all the way into the provider's
 * request body — see the note on `TranscriptionAudioSource`. Reading it into an
 * ArrayBuffer first held two copies of the same audio in a 128 MB isolate.
 */
async function resolveUpload(
  env: Env,
  ref: Extract<TranscriptionSourceRef, { kind: "upload" }>
): Promise<ResolvedSource> {
  const probe = await env.MEDIA.get(ref.r2Key, {
    range: { offset: 0, length: MEDIA_HEAD_BYTES },
  });
  if (!probe) {
    // Our own key, written moments ago by the upload route: a miss is a bug on
    // our side, never something the teacher did wrong.
    throw new TranscriptionError({ code: "internal", detail: "upload_missing" });
  }

  // R2 reports the whole object's size even on a ranged read.
  const bytes = probe.size;
  if (bytes > TRANSCRIPTION_MAX_UPLOAD_BYTES) {
    await probe.body?.cancel().catch(() => undefined);
    throw new TranscriptionError({
      code: "source_too_large",
      bytes,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    });
  }

  const head = new Uint8Array(await probe.arrayBuffer());
  const contentType = resolveMediaContentType(
    ref.filename,
    ref.contentType ?? probe.httpMetadata?.contentType ?? null
  );
  const durationSeconds = resolveDurationWithinCap({
    statedSeconds: null,
    contentType,
    bytes,
    head,
    requireKnownLength: false,
  });

  const object = await env.MEDIA.get(ref.r2Key);
  if (!object) {
    throw new TranscriptionError({ code: "internal", detail: "upload_missing" });
  }

  return {
    kind: "upload",
    audio: {
      kind: "bytes",
      blob: await object.blob(),
      sizeBytes: bytes,
      contentType,
      filename: ref.filename,
    },
    durationSeconds,
    contentType,
    bytes,
    title: ref.filename.replace(/\.[a-z0-9]{1,5}$/i, "") || ref.filename,
    resolvedUrl: null,
    r2Key: ref.r2Key,
  };
}

async function resolveDirectUrl(url: URL, fetcher: typeof fetch): Promise<ResolvedSource> {
  const probe = await probeMedia(url, fetcher);
  const contentType = resolveMediaContentType(probe.finalUrl.pathname, probe.contentType);
  const durationSeconds = resolveDurationWithinCap({
    statedSeconds: null,
    contentType,
    bytes: probe.bytes,
    head: probe.head,
    requireKnownLength: true,
  });

  return {
    kind: "direct_url",
    audio: { kind: "url", url: probe.finalUrl.toString() },
    durationSeconds,
    contentType,
    bytes: probe.bytes,
    title: titleFromUrl(probe.finalUrl),
    resolvedUrl: probe.finalUrl.toString(),
    r2Key: null,
  };
}

/**
 * Turn a stored source reference into media a provider can actually fetch.
 *
 * Re-classifies the URL first, so a reference that was persisted before a rule
 * changed — or hand-written into a payload — is judged by today's guard rather
 * than trusted. Throws `TranscriptionError` for everything the job row needs to
 * record; never returns a half-resolved source.
 */
export async function resolveSource(
  env: Env,
  ref: TranscriptionSourceRef,
  fetcher: typeof fetch = fetch
): Promise<ResolvedSource> {
  if (ref.kind === "upload") return resolveUpload(env, ref);

  const classified = classifySource(ref.url);
  if (!classified.supported || classified.url === null) {
    throw new TranscriptionError(classified.failure ?? { code: "unsupported_source", detail: "unrecognised_url" });
  }

  if (classified.kind === "direct_url") {
    return resolveDirectUrl(assertSafeUrl(classified.url), fetcher);
  }

  const target = await resolvePodcastTarget(classified.url, classified.podcastHint ?? "rss", fetcher);

  // The publisher's stated duration is the earliest signal we get, so a feed that
  // admits its episode is three hours long is refused before we fetch a byte of
  // it. A feed that says nothing — or understates — is caught by the container
  // header below.
  assertWithinDurationCap(target.durationSeconds);

  const probe = await probeMedia(target.audioUrl, fetcher);
  const contentType = resolveMediaContentType(
    probe.finalUrl.pathname,
    probe.contentType ?? target.contentType
  );
  const bytes = probe.bytes ?? target.bytes;
  const durationSeconds = resolveDurationWithinCap({
    statedSeconds: target.durationSeconds,
    contentType,
    bytes,
    head: probe.head,
    requireKnownLength: true,
  });

  return {
    kind: "podcast",
    audio: { kind: "url", url: probe.finalUrl.toString() },
    durationSeconds,
    contentType,
    bytes,
    title: target.title ?? titleFromUrl(probe.finalUrl),
    resolvedUrl: probe.finalUrl.toString(),
    r2Key: null,
  };
}
