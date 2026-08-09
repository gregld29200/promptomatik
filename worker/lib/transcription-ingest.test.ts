import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  isTranscriptionError,
  type TranscriptionFailure,
  type TranscriptionSourceRef,
} from "./transcription/types";
import {
  classifySource,
  listPodcastEpisodes,
  parseItunesDuration,
  parsePodcastFeed,
  resolveSource,
  scrapeEpisodePage,
} from "./transcription-ingest";

// ---------------------------------------------------------------------------
// Test doubles — every network call is mocked. Nothing here touches the wire.
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  method: string;
  range: string | null;
}

type Handler = (url: string, method: string) => Response;

function makeFetch(handler: Handler): { fetcher: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = async (input: string, init?: { method?: string; headers?: Record<string, string> }) => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url: input, method, range: headers.get("range") });
    return handler(input, method);
  };
  return { fetcher: impl as unknown as typeof fetch, calls };
}

/** Routes keyed by exact URL. An unrouted URL is a test bug, not a 404. */
function routedFetch(routes: Record<string, (method: string) => Response>): {
  fetcher: typeof fetch;
  calls: RecordedCall[];
} {
  return makeFetch((url, method) => {
    const route = routes[url];
    if (!route) throw new Error(`unrouted fetch: ${method} ${url}`);
    return route(method);
  });
}

function audioHead(contentType = "audio/mpeg", length = 27_123_456): Response {
  return new Response(null, {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(length) },
  });
}

function xml(body: string, contentType = "application/rss+xml"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

const NO_ENV = {} as Env;

/**
 * An R2 stand-in. `resolveSource` reads an upload twice — a ranged read for the
 * container header the duration gate needs, then the whole object as a Blob for
 * the provider — so both are recorded and both are asserted on below.
 */
function uploadEnv(
  object: { size: number; contentType?: string | null; payload?: Uint8Array } | null
): { env: Env; reads: { ranged: boolean }[] } {
  const reads: { ranged: boolean }[] = [];
  const env = {
    MEDIA: {
      get: async (_key: string, options?: { range?: unknown }): Promise<unknown> => {
        reads.push({ ranged: options?.range !== undefined });
        if (!object) return null;
        const payload = object.payload ?? new TextEncoder().encode("fake-audio-bytes");
        return {
          // R2 reports the whole object's size even for a ranged read.
          size: object.size,
          httpMetadata: object.contentType ? { contentType: object.contentType } : {},
          body: null,
          arrayBuffer: async (): Promise<ArrayBuffer> => payload.buffer as ArrayBuffer,
          blob: async (): Promise<Blob> => new Blob([payload]),
        };
      },
    },
  } as unknown as Env;
  return { env, reads };
}

/** A minimal RIFF/WAVE head: 44.1 kHz stereo PCM with `dataSize` bytes of audio. */
function wavHead(dataSize: number): Uint8Array {
  const head = new Uint8Array(44);
  const view = new DataView(head.buffer);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) head[at + i] = text.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, 44_100, true); // sample rate
  view.setUint32(28, 176_400, true); // byte rate
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, dataSize, true);
  return head;
}

/** An MPEG-1 Layer III frame header: 64 kbps, 44.1 kHz, mono. */
function mp3Head(): Uint8Array {
  const head = new Uint8Array(512);
  head[0] = 0xff;
  head[1] = 0xfb;
  head[2] = 0x50;
  head[3] = 0xc0;
  return head;
}

async function failureOf(promise: Promise<unknown>): Promise<TranscriptionFailure> {
  try {
    await promise;
  } catch (error) {
    if (isTranscriptionError(error)) return error.failure;
    throw error;
  }
  throw new Error("expected the promise to reject with a TranscriptionError");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A realistic FR podcast feed: newest first, one item deliberately audio-less. */
const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Le Podcast des Profs</title>
    <link>https://podcast.example.fr</link>
    <language>fr-FR</language>
    <item>
      <title><![CDATA[Épisode 42 — L'imparfait &amp; le passé composé]]></title>
      <pubDate>Tue, 05 Aug 2026 06:00:00 +0000</pubDate>
      <guid isPermaLink="false">ep-42</guid>
      <itunes:duration>28:15</itunes:duration>
      <enclosure url="https://cdn.example.fr/ep42.mp3?token=abc&amp;v=2" length="27123456" type="audio/mpeg"/>
    </item>
    <item>
      <title>Épisode 41 — Annonce (pas d'audio)</title>
      <pubDate>Tue, 29 Jul 2026 06:00:00 +0000</pubDate>
      <guid isPermaLink="false">ep-41</guid>
    </item>
    <item>
      <title>Épisode 40 — Le subjonctif</title>
      <pubDate>Tue, 22 Jul 2026 06:00:00 +0000</pubDate>
      <guid isPermaLink="false">ep-40</guid>
      <itunes:duration>1:02:03</itunes:duration>
      <enclosure url="https://cdn.example.fr/ep40.mp3" length="60000000" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Cast</title>
  <entry>
    <title>Entrée 7</title>
    <id>atom-7</id>
    <published>2026-08-01T10:00:00Z</published>
    <link rel="alternate" href="https://atom.example.com/7"/>
    <link rel="enclosure" type="audio/mp4" length="1234567" href="https://atom.example.com/7.m4a"/>
  </entry>
</feed>`;

const FEED_WITHOUT_ENCLOSURE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Notes seulement</title>
  <item><title>Note 1</title><guid>n1</guid></item>
  <item><title>Note 2</title><guid>n2</guid></item>
</channel></rss>`;

/**
 * A chronological feed — oldest item first. Nothing in RSS forbids it, and a
 * teacher who pastes one must still get the latest episode, not a 2019 archive
 * they then pay ledger seconds for.
 */
const CHRONOLOGICAL_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Archives FLE</title>
    <item>
      <title>Épisode 1 (2019)</title>
      <pubDate>Mon, 07 Jan 2019 08:00:00 +0000</pubDate>
      <guid>ep-1</guid>
      <itunes:duration>21:00</itunes:duration>
      <enclosure url="https://cdn.example.fr/old.mp3" length="20000000" type="audio/mpeg"/>
    </item>
    <item>
      <title>Épisode 200 (2026)</title>
      <pubDate>Mon, 03 Aug 2026 08:00:00 +0000</pubDate>
      <guid>ep-200</guid>
      <itunes:duration>24:00</itunes:duration>
      <enclosure url="https://cdn.example.fr/new.mp3" length="22000000" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

/** No item states a date we can use, so document order is all we have left. */
const FEED_WITHOUT_USABLE_DATES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Sans dates</title>
  <item>
    <title>Le plus récent</title>
    <guid>a</guid>
    <enclosure url="https://cdn.example.fr/a.mp3" length="18000000" type="audio/mpeg"/>
  </item>
  <item>
    <title>Plus ancien</title>
    <pubDate>bientôt</pubDate>
    <guid>b</guid>
    <enclosure url="https://cdn.example.fr/b.mp3" length="18000000" type="audio/mpeg"/>
  </item>
</channel></rss>`;

/**
 * The shapes that used to kill a job: a cover-art item published AFTER the
 * episode, and an episode whose PDF transcript is enclosed before its audio.
 */
const FEED_WITH_NON_AUDIO_MEDIA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <title>Média mélangé</title>
  <item>
    <title>Illustration de la saison 3</title>
    <pubDate>Wed, 05 Aug 2026 06:00:00 +0000</pubDate>
    <guid>art</guid>
    <media:content url="https://cdn.example.fr/art.jpg" type="image/jpeg" fileSize="90000"/>
  </item>
  <item>
    <title>Épisode 2 — la dictée</title>
    <pubDate>Tue, 04 Aug 2026 06:00:00 +0000</pubDate>
    <guid>ep-2</guid>
    <enclosure url="https://cdn.example.fr/ep2-transcription.pdf" length="120000" type="application/pdf"/>
    <enclosure url="https://cdn.example.fr/ep2.mp3" length="19000000" type="audio/mpeg"/>
  </item>
</channel></rss>`;

/** An extension-less, type-less enclosure: common on CDNs, only a probe can judge. */
const FEED_WITH_OPAQUE_ENCLOSURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>CDN opaque</title>
  <item>
    <title>Épisode sans extension</title>
    <pubDate>Tue, 04 Aug 2026 06:00:00 +0000</pubDate>
    <guid>ep-x</guid>
    <enclosure url="https://cdn.example.fr/dl?id=9" length="18000000"/>
  </item>
</channel></rss>`;

const EPISODE_PAGE_WITH_AUDIO = `<!doctype html><html><head>
  <title>Episode 12 | Indie Cast</title>
  <meta property="og:title" content="Episode 12 — La dictée"/>
  <meta property="og:audio" content="/media/ep12.mp3"/>
  <link rel="alternate" type="application/rss+xml" href="https://indie.example.com/feed.xml"/>
</head><body><audio src="/media/ep12-lowres.mp3"></audio></body></html>`;

const EPISODE_PAGE_WITHOUT_AUDIO = `<!doctype html><html><head>
  <title>À propos</title>
</head><body><p>Rien à écouter ici.</p></body></html>`;

/**
 * A page that emits lower-trust audio metas BEFORE its canonical
 * `og:audio:secure_url`. Document order must not win: the decoy is a file the
 * teacher never asked for, and transcribing it spends real quota.
 */
const EPISODE_PAGE_WITH_DECOY_META = `<!doctype html><html><head>
  <title>Episode 13 | Indie Cast</title>
  <meta name="audio" content="https://decoy.example.com/wrong.mp3"/>
  <meta name="twitter:player:stream" content="https://decoy.example.com/stream.mp3"/>
  <meta property="og:audio" content="https://cdn.example.com/plain.mp3"/>
  <meta property="og:audio:secure_url" content="https://cdn.example.com/right.mp3"/>
</head><body><audio src="/media/lowres.mp3"></audio></body></html>`;

/**
 * Every real attribute here is shadowed by a `data-` twin placed FIRST in the
 * tag. A `\b`-anchored name matches between `-` and a letter, so `data-url` used
 * to satisfy a search for `url` and — first match in the tag wins — beat it.
 * Read backwards this item bills a teacher for `lowres.mp3`, or (once
 * `data-type` is believed) disappears from the feed as "not audio".
 */
const FEED_WITH_DATA_PREFIXED_ATTRIBUTES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Attributs préfixés</title>
  <item>
    <title>Épisode piégé</title>
    <guid>ep-decoy</guid>
    <enclosure data-url="https://decoy.example.fr/lowres.mp3" url="https://cdn.example.fr/real.mp3" data-type="image/jpeg" type="audio/mpeg" data-length="1" length="19000000"/>
  </item>
</channel></rss>`;

/** The same shadowing on Atom's `<link rel="enclosure">`: `data-rel` first. */
const ATOM_FEED_WITH_DATA_PREFIXED_LINK = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom préfixé</title>
  <entry>
    <title>Entrée 8</title>
    <id>atom-8</id>
    <link data-rel="alternate" rel="enclosure" data-type="text/html" type="audio/mp4" data-href="https://decoy.example.com/8.html" href="https://atom.example.com/8.m4a"/>
  </entry>
</feed>`;

/** Unquoted values are legal HTML5, and hand-written documents do ship them. */
const FEED_WITH_UNQUOTED_ATTRIBUTES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Sans guillemets</title>
  <item>
    <title>Épisode brut</title>
    <guid>ep-raw</guid>
    <enclosure url=https://cdn.example.fr/raw.mp3 length=18000000 type=audio/mpeg/>
  </item>
</channel></rss>`;

/**
 * The ordinary lazy-loading player: the real `src` sits after a `data-src`
 * placeholder. The page also ships a decoy feed link whose `data-type` is the
 * only thing claiming RSS.
 */
const EPISODE_PAGE_WITH_DATA_PREFIXED_ATTRIBUTES = `<!doctype html><html><head>
  <title>Episode 14 | Indie Cast</title>
  <link data-type="application/rss+xml" href="https://decoy.example.com/wrong.xml" rel="alternate"/>
  <link rel="alternate" type="application/rss+xml" href="https://indie.example.com/feed.xml"/>
</head><body>
  <audio data-src="https://decoy.example.com/lowres.mp3" src="https://cdn.example.com/real.mp3"></audio>
</body></html>`;

/** A `data-property` twin must not let a low-trust meta occupy the top slot. */
const EPISODE_PAGE_WITH_DATA_PREFIXED_META = `<!doctype html><html><head>
  <title>Episode 15 | Indie Cast</title>
  <meta data-property="og:audio:secure_url" name="audio" data-content="https://decoy.example.com/hidden.mp3" content="https://decoy.example.com/wrong.mp3"/>
  <meta property="og:audio" content="https://cdn.example.com/right.mp3"/>
</head><body></body></html>`;

/** An extension-less stream whose only proof of audio is its `type`. */
const EPISODE_PAGE_WITH_TYPED_SOURCE = `<!doctype html><html><head>
  <title>Episode 16 | Indie Cast</title>
</head><body><audio controls>
  <source data-type="image/jpeg" type="audio/mpeg" src="https://cdn.example.com/stream?id=16"/>
</audio></body></html>`;

/** Unquoted values, plus a self-closing `<source/>` whose `/` is not part of the URL. */
const EPISODE_PAGE_WITH_UNQUOTED_ATTRIBUTES = `<!doctype html><html><head>
  <title>Episode 17 | Indie Cast</title>
  <link rel=alternate type=application/rss+xml href=/feed.xml>
</head><body><audio><source src=/media/ep17.mp3/></audio></body></html>`;

/** ISO-8859-1 on the wire, declared only in the XML prologue. Still common. */
const LATIN1_FEED = `<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0"><channel>
  <title>Le Podcast des Profs</title>
  <item>
    <title>Épisode 42 : l'imparfait</title>
    <guid>ep-42</guid>
    <enclosure url="https://cdn.example.fr/ep42.mp3" length="27123456" type="audio/mpeg"/>
  </item>
</channel></rss>`;

/** The same feed, but the prologue lies about being UTF-8 — the header is right. */
const LATIN1_FEED_LYING_PROLOGUE = LATIN1_FEED.replace("ISO-8859-1", "UTF-8");

/** One byte per code point — only valid for text that is entirely Latin-1. */
function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) throw new Error(`not Latin-1 encodable: U+${code.toString(16)}`);
    out[index] = code;
  }
  return out;
}

// ---------------------------------------------------------------------------
// classifySource — the supported branches
// ---------------------------------------------------------------------------

describe("classifySource — direct media URLs", () => {
  const extensions = ["mp3", "m4a", "mp4", "wav", "flac", "ogg", "webm", "aac"];

  it.each(extensions)("recognises .%s as a direct audio file", (extension) => {
    const result = classifySource(`https://cdn.example.com/lesson.${extension}`);
    expect(result).toEqual({
      kind: "direct_url",
      url: `https://cdn.example.com/lesson.${extension}`,
      supported: true,
      failure: null,
      podcastHint: null,
    });
  });

  it("keeps the query string of a signed CDN link", () => {
    const result = classifySource("https://cdn.example.com/ep.mp3?token=abc&v=2");
    expect(result.supported).toBe(true);
    expect(result.kind).toBe("direct_url");
    expect(result.url).toBe("https://cdn.example.com/ep.mp3?token=abc&v=2");
  });

  it("reads a scheme-less paste as https", () => {
    const result = classifySource("  cdn.example.com/ep.mp3  ");
    expect(result.supported).toBe(true);
    expect(result.url).toBe("https://cdn.example.com/ep.mp3");
  });

  it("accepts an explicit :443 but not another port", () => {
    expect(classifySource("https://cdn.example.com:443/ep.mp3").supported).toBe(true);
    expect(classifySource("https://cdn.example.com:8080/ep.mp3").failure).toEqual({
      code: "unsupported_source",
      detail: "blocked_port",
    });
  });
});

describe("classifySource — podcast feeds and pages", () => {
  const feeds = [
    "https://podcast.example.fr/feed.xml",
    "https://podcast.example.fr/rss",
    "https://podcast.example.fr/podcast/rss",
    "https://feeds.megaphone.fm/ABCD1234567",
    "https://anchor.fm/s/1a2b3c/podcast/rss",
    "https://podcast.example.fr/index.php?format=rss",
  ];

  it.each(feeds)("classifies %s as an RSS feed", (url) => {
    const result = classifySource(url);
    expect(result.kind).toBe("podcast");
    expect(result.supported).toBe(true);
    expect(result.podcastHint).toBe("rss");
  });

  const pages = [
    "https://overcast.fm/+AbCdEfG",
    "https://pca.st/episode/xyz",
    "https://indie.example.com/episodes/12-la-dictee",
    "https://www.radiofrance.fr/franceculture/podcasts/emission/quelque-chose",
  ];

  it.each(pages)("classifies %s as an episode page", (url) => {
    const result = classifySource(url);
    expect(result.kind).toBe("podcast");
    expect(result.supported).toBe(true);
    expect(result.podcastHint).toBe("episode_page");
  });

  it("classifies an Apple Podcasts show link with its numeric id", () => {
    const result = classifySource("https://podcasts.apple.com/fr/podcast/le-podcast-des-profs/id1234567890");
    expect(result.kind).toBe("podcast");
    expect(result.supported).toBe(true);
    expect(result.podcastHint).toBe("apple");
  });

  it("classifies an Apple Podcasts episode link (?i=)", () => {
    const result = classifySource(
      "https://podcasts.apple.com/fr/podcast/episode-42/id1234567890?i=1000700000001"
    );
    expect(result.podcastHint).toBe("apple");
    expect(result.supported).toBe(true);
  });

  it("refuses an Apple URL with no numeric id", () => {
    const result = classifySource("https://podcasts.apple.com/fr/browse");
    expect(result.supported).toBe(false);
    expect(result.failure).toEqual({ code: "unsupported_source", detail: "apple_no_id" });
  });
});

// ---------------------------------------------------------------------------
// classifySource — the two recognised-but-unsupported platforms
// ---------------------------------------------------------------------------

describe("classifySource — YouTube is recognised, not promised", () => {
  const youtubeUrls = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
  ];

  it.each(youtubeUrls)("types %s as youtube_not_yet_supported", (url) => {
    const result = classifySource(url);
    expect(result.kind).toBe("youtube");
    expect(result.supported).toBe(false);
    expect(result.failure?.code).toBe("youtube_not_yet_supported");
  });

  it("never reports YouTube as a generic unsupported source", () => {
    const failure = classifySource("https://www.youtube.com/watch?v=abc").failure;
    expect(failure?.code).not.toBe("unsupported_source");
    expect(failure).toEqual({
      code: "youtube_not_yet_supported",
      url: "https://www.youtube.com/watch?v=abc",
    });
  });
});

describe("classifySource — Spotify is politely out of scope", () => {
  const spotifyUrls = [
    "https://open.spotify.com/episode/1a2b3c4d",
    "https://open.spotify.com/show/5x6y7z",
    "https://spotify.link/abcdef",
  ];

  it.each(spotifyUrls)("types %s as spotify_not_supported", (url) => {
    const result = classifySource(url);
    expect(result.supported).toBe(false);
    expect(result.failure?.code).toBe("spotify_not_supported");
    expect(result.podcastHint).toBe("generic");
  });
});

describe("classifySource — unknown input", () => {
  it("refuses an ordinary web page", () => {
    const result = classifySource("https://example.com/blog/bonjour");
    expect(result.supported).toBe(false);
    expect(result.failure).toEqual({ code: "unsupported_source", detail: "unrecognised_url" });
  });

  it("refuses empty input", () => {
    expect(classifySource("   ").failure).toEqual({ code: "unsupported_source", detail: "empty" });
    expect(classifySource("   ").url).toBeNull();
  });

  it("refuses free text that is not a URL", () => {
    const result = classifySource("transcris mon cours d'hier");
    expect(result.supported).toBe(false);
    expect(result.failure?.code).toBe("unsupported_source");
  });
});

// ---------------------------------------------------------------------------
// SSRF — the whole point of this module having a guard at all
// ---------------------------------------------------------------------------

describe("classifySource — SSRF guard", () => {
  const blockedHosts = [
    ["loopback /8", "http://127.0.0.1/a.mp3"],
    ["loopback, other octet", "http://127.99.88.77/a.mp3"],
    ["0.0.0.0", "http://0.0.0.0/a.mp3"],
    ["0/8", "http://0.1.2.3/a.mp3"],
    ["private 10/8", "http://10.0.0.5/a.mp3"],
    ["private 172.16/12 low", "http://172.16.0.1/a.mp3"],
    ["private 172.16/12 high", "http://172.31.255.254/a.mp3"],
    ["private 192.168/16", "http://192.168.1.1/a.mp3"],
    ["link-local 169.254/16", "http://169.254.1.1/a.mp3"],
    ["AWS/GCP metadata", "http://169.254.169.254/latest/meta-data/iam/"],
    ["CGNAT 100.64/10", "http://100.64.0.1/a.mp3"],
    ["benchmark 198.18/15", "http://198.19.0.1/a.mp3"],
    ["multicast", "http://224.0.0.1/a.mp3"],
    ["broadcast", "http://255.255.255.255/a.mp3"],
    ["localhost", "http://localhost/a.mp3"],
    ["localhost with trailing dot", "http://LOCALHOST./a.mp3"],
    ["*.localhost", "http://app.localhost/a.mp3"],
    ["*.local (mDNS)", "http://printer.local/a.mp3"],
    ["*.internal", "http://vault.internal/a.mp3"],
    ["GCP metadata name", "http://metadata.google.internal/computeMetadata/v1/"],
    ["*.home.arpa", "http://nas.home.arpa/a.mp3"],
    ["IPv6 loopback", "http://[::1]/a.mp3"],
    ["IPv6 unspecified", "http://[::]/a.mp3"],
    ["IPv6 unique local fc00::/7", "http://[fc00::1]/a.mp3"],
    ["IPv6 unique local fd00::/8", "http://[fd12:3456::1]/a.mp3"],
    ["IPv6 link-local fe80::/10", "http://[fe80::1]/a.mp3"],
    ["IPv6 multicast", "http://[ff02::1]/a.mp3"],
    ["IPv4-mapped IPv6", "http://[::ffff:127.0.0.1]/a.mp3"],
    ["IPv6 6to4 wrapping loopback", "http://[2002:7f00:0001::]/a.mp3"],
    ["IPv6 6to4 wrapping a private range", "http://[2002:0a00:0005::1]/a.mp3"],
    // Teredo (2001:0::/32) embeds an arbitrary IPv4 in exactly the way 6to4 does,
    // so the guard's own stated reason applies to it too.
    ["IPv6 Teredo", "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/a.mp3"],
    ["IPv6 Teredo, zero-run spelling", "http://[2001::4136:e378]/a.mp3"],
    ["IPv6 documentation range 2001:db8::/32", "http://[2001:db8::1]/a.mp3"],
    ["6to4 relay anycast 192.88.99/24", "http://192.88.99.1/a.mp3"],
    ["decimal IP literal", "http://2130706433/a.mp3"],
    ["hex IP literal", "http://0x7f000001/a.mp3"],
    ["octal IP literal", "http://017700000001/a.mp3"],
    ["short-form IP literal", "http://127.1/a.mp3"],
  ] as const;

  it.each(blockedHosts)("blocks %s", (_label, url) => {
    const result = classifySource(url);
    expect(result.supported).toBe(false);
    expect(result.failure?.code).toBe("unsupported_source");
  });

  it("reports blocked_host for private destinations rather than leaking details", () => {
    for (const url of ["http://127.0.0.1/a.mp3", "http://10.0.0.5/a.mp3", "http://localhost/a.mp3"]) {
      expect(classifySource(url).failure).toEqual({ code: "unsupported_source", detail: "blocked_host" });
    }
  });

  const badSchemes = [
    ["file", "file:///etc/passwd"],
    ["data", "data:audio/mpeg;base64,AAAAAA"],
    ["gopher", "gopher://example.com/1"],
    ["ftp", "ftp://example.com/a.mp3"],
    ["javascript", "javascript:alert(1)"],
    ["ws", "ws://example.com/socket"],
  ] as const;

  it.each(badSchemes)("refuses the %s scheme", (scheme, url) => {
    const result = classifySource(url);
    expect(result.supported).toBe(false);
    expect(result.failure).toEqual({ code: "unsupported_source", detail: `scheme_${scheme}` });
  });

  it("refuses credentials in the URL, even towards a public host", () => {
    expect(classifySource("http://user:pass@cdn.example.com/a.mp3").failure).toEqual({
      code: "unsupported_source",
      detail: "credentials_in_url",
    });
    expect(classifySource("https://admin@cdn.example.com/a.mp3").failure).toEqual({
      code: "unsupported_source",
      detail: "credentials_in_url",
    });
  });

  it("refuses non-web ports", () => {
    for (const url of [
      "http://cdn.example.com:6379/a.mp3",
      "http://cdn.example.com:22/a.mp3",
      "http://cdn.example.com:9200/a.mp3",
    ]) {
      expect(classifySource(url).failure).toEqual({ code: "unsupported_source", detail: "blocked_port" });
    }
  });

  it("still allows a legitimate public IPv6 host", () => {
    expect(classifySource("https://[2606:4700::1111]/lesson.mp3").supported).toBe(true);
    // The rest of 2001::/16 is ordinary global unicast — only 2001:0 and 2001:db8 go.
    expect(classifySource("https://[2001:4860:4860::8888]/lesson.mp3").supported).toBe(true);
  });
});

describe("resolveSource — SSRF guard on redirects", () => {
  it("re-validates each hop and refuses a redirect into link-local space", async () => {
    const { fetcher, calls } = makeFetch((url) => {
      if (url === "https://cdn.example.com/ep.mp3") {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
      }
      throw new Error(`must not fetch ${url}`);
    });

    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.com/ep.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "blocked_host" });
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect into private space given as a relative-host location", async () => {
    const { fetcher } = makeFetch((url) => {
      if (url === "https://cdn.example.com/ep.mp3") {
        return new Response(null, { status: 301, headers: { location: "http://10.1.2.3/ep.mp3" } });
      }
      throw new Error(`must not fetch ${url}`);
    });

    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.com/ep.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "blocked_host" });
  });

  it("follows a legitimate tracking redirect and reports the final URL", async () => {
    const { fetcher, calls } = makeFetch((url) => {
      if (url === "https://chrt.example.com/track/ep.mp3") {
        return new Response(null, { status: 302, headers: { location: "https://media.example.net/final.mp3" } });
      }
      if (url === "https://media.example.net/final.mp3") return audioHead();
      throw new Error(`unrouted ${url}`);
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "direct_url", url: "https://chrt.example.com/track/ep.mp3" },
      fetcher
    );
    expect(resolved.audio).toEqual({ kind: "url", url: "https://media.example.net/final.mp3" });
    expect(resolved.resolvedUrl).toBe("https://media.example.net/final.mp3");
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
  });

  it("gives up on an endless redirect chain instead of looping", async () => {
    const { fetcher, calls } = makeFetch(
      () => new Response(null, { status: 302, headers: { location: "https://cdn.example.com/next.mp3" } })
    );
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.com/ep.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "source_unreachable" });
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it("refuses an enclosure URL that points at the metadata service", async () => {
    const hostileFeed = `<rss><channel><title>Hostile</title><item>
      <title>Pwn</title><guid>x</guid>
      <enclosure url="http://169.254.169.254/latest/meta-data/" length="100" type="audio/mpeg"/>
    </item></channel></rss>`;

    const { fetcher, calls } = routedFetch({
      "https://hostile.example.com/feed.xml": () => xml(hostileFeed),
    });

    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://hostile.example.com/feed.xml" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "blocked_host" });
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Feed parsing
// ---------------------------------------------------------------------------

describe("parsePodcastFeed", () => {
  const feed = parsePodcastFeed(RSS_FEED, "https://podcast.example.fr/feed.xml");

  it("reads the channel title, not the first item title", () => {
    expect(feed.title).toBe("Le Podcast des Profs");
  });

  it("keeps only the items that carry an enclosure", () => {
    expect(feed.episodes).toHaveLength(2);
    expect(feed.episodes.map((episode) => episode.guid)).toEqual(["ep-42", "ep-40"]);
  });

  it("extracts the enclosure URL with its entities decoded", () => {
    expect(feed.episodes[0].audioUrl).toBe("https://cdn.example.fr/ep42.mp3?token=abc&v=2");
    expect(feed.episodes[0].contentType).toBe("audio/mpeg");
    expect(feed.episodes[0].bytes).toBe(27_123_456);
  });

  it("decodes CDATA titles and accented French", () => {
    expect(feed.episodes[0].title).toBe("Épisode 42 — L'imparfait & le passé composé");
  });

  it("reads itunes:duration in mm:ss and hh:mm:ss", () => {
    expect(feed.episodes[0].durationSeconds).toBe(1695);
    expect(feed.episodes[1].durationSeconds).toBe(3723);
  });

  it("keeps the publication date for the picker", () => {
    expect(feed.episodes[0].publishedAt).toBe("Tue, 05 Aug 2026 06:00:00 +0000");
  });

  it("returns an empty episode list for a feed with no enclosure anywhere", () => {
    const empty = parsePodcastFeed(FEED_WITHOUT_ENCLOSURE, "https://x.example.com/feed.xml");
    expect(empty.title).toBe("Notes seulement");
    expect(empty.episodes).toEqual([]);
  });

  it("drops an item whose only media the feed itself declares as an image", () => {
    const mixed = parsePodcastFeed(FEED_WITH_NON_AUDIO_MEDIA, "https://mixed.example.fr/feed.xml");
    expect(mixed.episodes.map((episode) => episode.guid)).toEqual(["ep-2"]);
    expect(mixed.episodes.map((episode) => episode.audioUrl)).not.toContain(
      "https://cdn.example.fr/art.jpg"
    );
  });

  it("takes the audio enclosure over a PDF transcript enclosed before it", () => {
    const mixed = parsePodcastFeed(FEED_WITH_NON_AUDIO_MEDIA, "https://mixed.example.fr/feed.xml");
    expect(mixed.episodes[0]).toMatchObject({
      audioUrl: "https://cdn.example.fr/ep2.mp3",
      contentType: "audio/mpeg",
      bytes: 19_000_000,
    });
  });

  it("keeps an extension-less, type-less enclosure for the probe to judge", () => {
    const opaque = parsePodcastFeed(FEED_WITH_OPAQUE_ENCLOSURE, "https://cdn.example.fr/feed.xml");
    expect(opaque.episodes).toHaveLength(1);
    expect(opaque.episodes[0].audioUrl).toBe("https://cdn.example.fr/dl?id=9");
    expect(opaque.episodes[0].contentType).toBeNull();
  });

  it("understands an Atom feed's rel=enclosure link", () => {
    const atom = parsePodcastFeed(ATOM_FEED, "https://atom.example.com/feed");
    expect(atom.episodes).toHaveLength(1);
    expect(atom.episodes[0]).toMatchObject({
      title: "Entrée 7",
      audioUrl: "https://atom.example.com/7.m4a",
      contentType: "audio/mp4",
      bytes: 1_234_567,
      guid: "atom-7",
    });
  });
});

describe("parseItunesDuration", () => {
  it.each([
    ["3600", 3600],
    ["28:15", 1695],
    ["1:02:03", 3723],
    ["00:45", 45],
    ["12:34.5", 755],
  ])("parses %s", (raw, expected) => {
    expect(parseItunesDuration(raw)).toBe(expected);
  });

  it.each(["", "   ", "about an hour", "1:2:3:4", null])("returns null for %s", (raw) => {
    expect(parseItunesDuration(raw)).toBeNull();
  });
});

describe("scrapeEpisodePage", () => {
  it("prefers og:audio and resolves it against the page URL", () => {
    const page = scrapeEpisodePage(EPISODE_PAGE_WITH_AUDIO, "https://indie.example.com/episodes/12");
    expect(page.audioUrl).toBe("https://indie.example.com/media/ep12.mp3");
    expect(page.title).toBe("Episode 12 — La dictée");
    expect(page.feedUrl).toBe("https://indie.example.com/feed.xml");
  });

  it("finds nothing on a page with no audio", () => {
    const page = scrapeEpisodePage(EPISODE_PAGE_WITHOUT_AUDIO, "https://indie.example.com/about");
    expect(page.audioUrl).toBeNull();
    expect(page.feedUrl).toBeNull();
    expect(page.title).toBe("À propos");
  });

  it("ranks meta names by trust, not by document order", () => {
    const page = scrapeEpisodePage(EPISODE_PAGE_WITH_DECOY_META, "https://indie.example.com/episodes/13");
    expect(page.audioUrl).toBe("https://cdn.example.com/right.mp3");
  });

  it("falls to og:audio only once og:audio:secure_url is absent", () => {
    const withoutSecureUrl = EPISODE_PAGE_WITH_DECOY_META.replace(
      '<meta property="og:audio:secure_url" content="https://cdn.example.com/right.mp3"/>',
      ""
    );
    const page = scrapeEpisodePage(withoutSecureUrl, "https://indie.example.com/episodes/13");
    expect(page.audioUrl).toBe("https://cdn.example.com/plain.mp3");
  });

  it("prefers a player stream over a bare name=audio decoy", () => {
    const streamOnly = EPISODE_PAGE_WITH_DECOY_META.replace(
      /<meta property="og:audio[^>]*>/g,
      ""
    );
    const page = scrapeEpisodePage(streamOnly, "https://indie.example.com/episodes/13");
    expect(page.audioUrl).toBe("https://decoy.example.com/stream.mp3");
  });
});

// ---------------------------------------------------------------------------
// Attribute reading — the `data-` shadowing class of bug, on both parse paths
// ---------------------------------------------------------------------------

describe("attribute reading — a data- prefixed twin never shadows the real attribute", () => {
  it("takes the real enclosure url, type and length, not the data- twins", () => {
    const feed = parsePodcastFeed(FEED_WITH_DATA_PREFIXED_ATTRIBUTES, "https://decoy.example.fr/feed.xml");
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]).toMatchObject({
      audioUrl: "https://cdn.example.fr/real.mp3",
      contentType: "audio/mpeg",
      bytes: 19_000_000,
    });
  });

  it("keeps an Atom entry whose rel, type and href each follow a data- twin", () => {
    const atom = parsePodcastFeed(ATOM_FEED_WITH_DATA_PREFIXED_LINK, "https://atom.example.com/feed");
    expect(atom.episodes).toHaveLength(1);
    expect(atom.episodes[0]).toMatchObject({
      audioUrl: "https://atom.example.com/8.m4a",
      contentType: "audio/mp4",
      guid: "atom-8",
    });
  });

  it("takes the real src of a lazy-loading audio element, not its data-src", () => {
    const page = scrapeEpisodePage(
      EPISODE_PAGE_WITH_DATA_PREFIXED_ATTRIBUTES,
      "https://indie.example.com/episodes/14"
    );
    expect(page.audioUrl).toBe("https://cdn.example.com/real.mp3");
  });

  it("ignores a feed link whose only rss claim is a data-type", () => {
    const page = scrapeEpisodePage(
      EPISODE_PAGE_WITH_DATA_PREFIXED_ATTRIBUTES,
      "https://indie.example.com/episodes/14"
    );
    expect(page.feedUrl).toBe("https://indie.example.com/feed.xml");
  });

  it("does not let a data-property twin promote a low-trust meta to og:audio:secure_url", () => {
    const page = scrapeEpisodePage(
      EPISODE_PAGE_WITH_DATA_PREFIXED_META,
      "https://indie.example.com/episodes/15"
    );
    expect(page.audioUrl).toBe("https://cdn.example.com/right.mp3");
  });

  it("believes the real type of an extension-less source over its data-type", () => {
    const page = scrapeEpisodePage(EPISODE_PAGE_WITH_TYPED_SOURCE, "https://indie.example.com/episodes/16");
    expect(page.audioUrl).toBe("https://cdn.example.com/stream?id=16");
  });

  it("finds no audio when a data-src is all the element has", () => {
    const html = `<!doctype html><html><head><title>Sans src</title></head>
      <body><audio data-src="https://decoy.example.com/only.mp3"></audio></body></html>`;
    const page = scrapeEpisodePage(html, "https://indie.example.com/episodes/18");
    expect(page.audioUrl).toBeNull();
  });
});

describe("attribute reading — unquoted values", () => {
  it("reads an unquoted enclosure url, length and type", () => {
    const feed = parsePodcastFeed(FEED_WITH_UNQUOTED_ATTRIBUTES, "https://cdn.example.fr/feed.xml");
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]).toMatchObject({
      audioUrl: "https://cdn.example.fr/raw.mp3",
      contentType: "audio/mpeg",
      bytes: 18_000_000,
    });
  });

  it("reads an unquoted src and feed href, without swallowing the self-closing slash", () => {
    const page = scrapeEpisodePage(
      EPISODE_PAGE_WITH_UNQUOTED_ATTRIBUTES,
      "https://indie.example.com/episodes/17"
    );
    expect(page.audioUrl).toBe("https://indie.example.com/media/ep17.mp3");
    expect(page.feedUrl).toBe("https://indie.example.com/feed.xml");
  });

  it("keeps a trailing slash the author actually wrote", () => {
    const html = `<!doctype html><html><head><title>Dossier</title>
      <link rel=alternate type=application/rss+xml href=/feed/ >
      </head><body><audio src=/media/ep19.mp3></audio></body></html>`;
    const page = scrapeEpisodePage(html, "https://indie.example.com/episodes/19");
    expect(page.feedUrl).toBe("https://indie.example.com/feed/");
    expect(page.audioUrl).toBe("https://indie.example.com/media/ep19.mp3");
  });
});

// ---------------------------------------------------------------------------
// resolveSource — direct URLs
// ---------------------------------------------------------------------------

describe("resolveSource — direct URL", () => {
  it("range-GETs the media head and reports its type, size and title", async () => {
    const { fetcher, calls } = routedFetch({
      "https://cdn.example.fr/cours-01.mp3": () => audioHead("audio/mpeg", 12_345_678),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "direct_url", url: "https://cdn.example.fr/cours-01.mp3" },
      fetcher
    );

    expect(resolved).toEqual({
      kind: "direct_url",
      audio: { kind: "url", url: "https://cdn.example.fr/cours-01.mp3" },
      durationSeconds: null,
      contentType: "audio/mpeg",
      bytes: 12_345_678,
      title: "cours-01",
      resolvedUrl: "https://cdn.example.fr/cours-01.mp3",
      r2Key: null,
    });
    // One round trip: the ranged GET yields the type, the length AND the container
    // header the duration gate reads. A HEAD could not have given us the last one.
    expect(calls).toEqual([
      { url: "https://cdn.example.fr/cours-01.mp3", method: "GET", range: "bytes=0-262143" },
    ]);
  });

  it("falls back to HEAD when the CDN refuses a ranged GET", async () => {
    const { fetcher, calls } = makeFetch((url, method) => {
      if (url !== "https://cdn.example.fr/ep.mp3") throw new Error(`unrouted ${url}`);
      if (method === "GET") return new Response(null, { status: 403 });
      return audioHead("audio/mpeg", 9_876_543);
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "direct_url", url: "https://cdn.example.fr/ep.mp3" },
      fetcher
    );
    // Type and size still arrive; only the container header is lost, so the cap
    // falls back to the byte-derived bound.
    expect(resolved.bytes).toBe(9_876_543);
    expect(resolved.durationSeconds).toBeNull();
    expect(calls.map((call) => call.method)).toEqual(["GET", "HEAD"]);
    expect(calls[0].range).toBe("bytes=0-262143");
  });

  it("reads the duration out of the container header and reports it", async () => {
    const { fetcher } = routedFetch({
      // 20 minutes of 44.1 kHz stereo PCM, per its own `fmt `/`data` chunks.
      "https://cdn.example.fr/atelier.wav": () =>
        new Response(wavHead(176_400 * 1_200), {
          status: 206,
          headers: {
            "content-type": "audio/wav",
            "content-range": `bytes 0-262143/${176_400 * 1_200 + 44}`,
          },
        }),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "direct_url", url: "https://cdn.example.fr/atelier.wav" },
      fetcher
    );
    expect(resolved.durationSeconds).toBe(1_200);
  });

  it("refuses a two-hour file whose byte count alone looks acceptable", async () => {
    // 60 MB of MP3 is 1 500 s at the highest bitrate MP3 defines, so the byte
    // bound admits it. The frame header says 64 kbps, i.e. over two hours.
    const { fetcher } = routedFetch({
      "https://cdn.example.fr/long.mp3": () =>
        new Response(mp3Head(), {
          status: 206,
          headers: {
            "content-type": "audio/mpeg",
            "content-range": "bytes 0-262143/60000000",
          },
        }),
    });

    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.fr/long.mp3" }, fetcher)
    );
    expect(failure).toMatchObject({ code: "source_too_long", maxSeconds: 5_400 });
  });

  it("does not mistake a 206 part length for the whole file", async () => {
    // `content-length` on a 206 is the 256 kB we asked for. Believing it would
    // report every ranged source as a quarter-megabyte and make the byte bound
    // meaningless — so only `content-range`'s total counts.
    const { fetcher } = routedFetch({
      "https://cdn.example.fr/part.mp3": () =>
        new Response(mp3Head(), {
          status: 206,
          headers: {
            "content-type": "audio/mpeg",
            "content-length": "262144",
            "content-range": "bytes 0-262143/9000000",
          },
        }),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "direct_url", url: "https://cdn.example.fr/part.mp3" },
      fetcher
    );
    expect(resolved.bytes).toBe(9_000_000);
    // 9 MB at the 64 kbps the frame header declares is about 18 minutes.
    expect(resolved.durationSeconds).toBeGreaterThan(1_000);
    expect(resolved.durationSeconds).toBeLessThan(1_300);
  });

  it("refuses a 206 with no content-range, whose length it cannot know", async () => {
    const { fetcher } = routedFetch({
      "https://cdn.example.fr/odd.mp3": () =>
        new Response(new Uint8Array(16), {
          status: 206,
          headers: { "content-type": "audio/mpeg", "content-length": "262144" },
        }),
    });

    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.fr/odd.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "unknown_length" });
  });

  it("refuses a source that declares no length at all — a stream has no end", async () => {
    const { fetcher } = routedFetch({
      "https://radio.example.fr/live.mp3": () =>
        new Response(null, { status: 200, headers: { "content-type": "audio/mpeg" } }),
    });

    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://radio.example.fr/live.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "unknown_length" });
  });

  it("accepts application/octet-stream when the path says .mp3", async () => {
    const { fetcher } = routedFetch({
      "https://cdn.example.fr/ep.mp3": () => audioHead("application/octet-stream", 5_000_000),
    });
    const resolved = await resolveSource(
      NO_ENV,
      { kind: "direct_url", url: "https://cdn.example.fr/ep.mp3" },
      fetcher
    );
    expect(resolved.contentType).toBe("audio/mpeg");
  });

  it("refuses an HTML page served behind an audio-looking path", async () => {
    const { fetcher } = routedFetch({
      "https://cdn.example.fr/ep.mp3": () => audioHead("text/html; charset=utf-8", 4_000),
    });
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.fr/ep.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_media_type", contentType: "text/html" });
  });

  it("reports the status when the media is simply gone", async () => {
    const { fetcher } = makeFetch(() => new Response(null, { status: 404 }));
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.fr/ep.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "source_unreachable", status: 404 });
  });

  it("turns a network failure into source_unreachable, never a raw throw", async () => {
    const fetcher = (() => Promise.reject(new TypeError("network error"))) as unknown as typeof fetch;
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.fr/ep.mp3" }, fetcher)
    );
    expect(failure).toEqual({ code: "source_unreachable" });
  });

  it("rejects a source whose byte count cannot fit inside 90 minutes", async () => {
    // 8 GB of WAV is over three hours even at 24-bit / 96 kHz stereo.
    const { fetcher } = routedFetch({
      "https://cdn.example.fr/huge.wav": () => audioHead("audio/wav", 8 * 1024 * 1024 * 1024),
    });
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "https://cdn.example.fr/huge.wav" }, fetcher)
    );
    expect(failure.code).toBe("source_too_long");
    expect(failure).toMatchObject({ maxSeconds: 5400 });
  });
});

// ---------------------------------------------------------------------------
// resolveSource — podcasts
// ---------------------------------------------------------------------------

describe("resolveSource — RSS feed", () => {
  it("resolves the newest episode's enclosure and carries its title and duration", async () => {
    const { fetcher, calls } = routedFetch({
      "https://podcast.example.fr/feed.xml": () => xml(RSS_FEED),
      "https://cdn.example.fr/ep42.mp3?token=abc&v=2": () => audioHead("audio/mpeg", 27_123_456),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://podcast.example.fr/feed.xml" },
      fetcher
    );

    expect(resolved).toEqual({
      kind: "podcast",
      audio: { kind: "url", url: "https://cdn.example.fr/ep42.mp3?token=abc&v=2" },
      durationSeconds: 1695,
      contentType: "audio/mpeg",
      bytes: 27_123_456,
      title: "Épisode 42 — L'imparfait & le passé composé",
      resolvedUrl: "https://cdn.example.fr/ep42.mp3?token=abc&v=2",
      r2Key: null,
    });
    // The feed, then the media head — both plain GETs, the second one ranged.
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(calls[1].range).toBe("bytes=0-262143");
  });

  it("resolves the newest episode of a chronological feed, not item 1", async () => {
    const { fetcher, calls } = routedFetch({
      "https://archives.example.fr/feed.xml": () => xml(CHRONOLOGICAL_FEED),
      "https://cdn.example.fr/new.mp3": () => audioHead("audio/mpeg", 22_000_000),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://archives.example.fr/feed.xml" },
      fetcher
    );

    expect(resolved.resolvedUrl).toBe("https://cdn.example.fr/new.mp3");
    expect(resolved.title).toBe("Épisode 200 (2026)");
    expect(resolved.durationSeconds).toBe(1440);
    // The 2019 archive was never even probed, so it can never be billed.
    expect(calls.map((call) => call.url)).toEqual([
      "https://archives.example.fr/feed.xml",
      "https://cdn.example.fr/new.mp3",
    ]);
  });

  it("falls back to document order only when no item states a usable date", async () => {
    const { fetcher } = routedFetch({
      "https://sans-dates.example.fr/feed.xml": () => xml(FEED_WITHOUT_USABLE_DATES),
      "https://cdn.example.fr/a.mp3": () => audioHead("audio/mpeg", 18_000_000),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://sans-dates.example.fr/feed.xml" },
      fetcher
    );
    expect(resolved.resolvedUrl).toBe("https://cdn.example.fr/a.mp3");
    expect(resolved.title).toBe("Le plus récent");
  });

  it("skips a cover-art item and transcribes the episode below it", async () => {
    const { fetcher, calls } = routedFetch({
      "https://mixed.example.fr/feed.xml": () => xml(FEED_WITH_NON_AUDIO_MEDIA),
      "https://cdn.example.fr/ep2.mp3": () => audioHead("audio/mpeg", 19_000_000),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://mixed.example.fr/feed.xml" },
      fetcher
    );
    expect(resolved.resolvedUrl).toBe("https://cdn.example.fr/ep2.mp3");
    expect(resolved.contentType).toBe("audio/mpeg");
    // Neither the JPEG nor the PDF was fetched: one feed read, one probe.
    expect(calls.map((call) => call.url)).toEqual([
      "https://mixed.example.fr/feed.xml",
      "https://cdn.example.fr/ep2.mp3",
    ]);
  });

  it("still resolves an extension-less enclosure once the CDN states its type", async () => {
    const { fetcher } = routedFetch({
      "https://cdn.example.fr/feed.xml": () => xml(FEED_WITH_OPAQUE_ENCLOSURE),
      "https://cdn.example.fr/dl?id=9": () => audioHead("audio/mpeg", 18_000_000),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://cdn.example.fr/feed.xml" },
      fetcher
    );
    expect(resolved.resolvedUrl).toBe("https://cdn.example.fr/dl?id=9");
    expect(resolved.contentType).toBe("audio/mpeg");
  });

  it("reports no_audio_found when no item in the feed has an enclosure", async () => {
    const { fetcher } = routedFetch({
      "https://podcast.example.fr/feed.xml": () => xml(FEED_WITHOUT_ENCLOSURE),
    });
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://podcast.example.fr/feed.xml" }, fetcher)
    );
    expect(failure).toEqual({ code: "no_audio_found", detail: "feed_has_no_enclosure" });
  });

  it("says no_audio_found for a feed of cover art rather than sending a JPEG", async () => {
    const artOnly = FEED_WITH_NON_AUDIO_MEDIA.replace(
      /<item>\s*<title>Épisode 2[\s\S]*?<\/item>/,
      ""
    );
    const { fetcher, calls } = routedFetch({
      "https://mixed.example.fr/feed.xml": () => xml(artOnly),
    });
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://mixed.example.fr/feed.xml" }, fetcher)
    );
    expect(failure).toEqual({ code: "no_audio_found", detail: "feed_has_no_enclosure" });
    expect(calls).toHaveLength(1);
  });

  it("rejects an over-long episode from the feed metadata, before touching the media", async () => {
    const longFeed = RSS_FEED.replace("<itunes:duration>28:15</itunes:duration>", "<itunes:duration>2:14:30</itunes:duration>");
    const { fetcher, calls } = routedFetch({
      "https://podcast.example.fr/feed.xml": () => xml(longFeed),
    });

    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://podcast.example.fr/feed.xml" }, fetcher)
    );
    expect(failure).toEqual({ code: "source_too_long", durationSeconds: 8070, maxSeconds: 5400 });
    // The whole point: no probe, and therefore never a provider call.
    expect(calls).toHaveLength(1);
  });

  it("refuses a document that is not a feed and has no audio", async () => {
    const { fetcher } = routedFetch({
      "https://indie.example.com/episodes/vide": () =>
        new Response(EPISODE_PAGE_WITHOUT_AUDIO, { status: 200, headers: { "content-type": "text/html" } }),
    });
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://indie.example.com/episodes/vide" }, fetcher)
    );
    expect(failure).toEqual({ code: "no_audio_found", detail: "page_has_no_audio" });
  });

  it("refuses a feed whose declared size is over the parsing cap", async () => {
    const { fetcher } = routedFetch({
      "https://podcast.example.fr/feed.xml": () =>
        new Response(RSS_FEED, {
          status: 200,
          headers: { "content-type": "application/rss+xml", "content-length": "99999999" },
        }),
    });
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://podcast.example.fr/feed.xml" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "feed_too_large" });
  });

  it("reads an ISO-8859-1 feed declared in its XML prologue without mangling accents", async () => {
    const { fetcher } = routedFetch({
      "https://podcast.example.fr/latin1.xml": () =>
        new Response(latin1Bytes(LATIN1_FEED), {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        }),
      "https://cdn.example.fr/ep42.mp3": () => audioHead(),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://podcast.example.fr/latin1.xml" },
      fetcher
    );
    expect(resolved.title).toBe("Épisode 42 : l'imparfait");
    expect(resolved.title).not.toContain("�");
  });

  it("trusts the Content-Type charset over a prologue that lies", async () => {
    const { fetcher } = routedFetch({
      "https://podcast.example.fr/latin1.xml": () =>
        new Response(latin1Bytes(LATIN1_FEED_LYING_PROLOGUE), {
          status: 200,
          headers: { "content-type": "text/xml; charset=windows-1252" },
        }),
      "https://cdn.example.fr/ep42.mp3": () => audioHead(),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://podcast.example.fr/latin1.xml" },
      fetcher
    );
    expect(resolved.title).toBe("Épisode 42 : l'imparfait");
  });

  it("still decodes a UTF-8 feed that declares nothing at all", async () => {
    const { fetcher } = routedFetch({
      "https://podcast.example.fr/feed.xml": () =>
        new Response(new TextEncoder().encode(RSS_FEED), { status: 200, headers: { "content-type": "text/xml" } }),
      "https://cdn.example.fr/ep42.mp3?token=abc&v=2": () => audioHead(),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://podcast.example.fr/feed.xml" },
      fetcher
    );
    expect(resolved.title).toBe("Épisode 42 — L'imparfait & le passé composé");
  });

  it("reads a windows-1252 episode page title, not replacement characters", async () => {
    const page = `<!doctype html><html><head>
      <meta charset="windows-1252"/>
      <title>Épisode 13 — la dictée</title>
      <meta property="og:audio" content="https://cdn.example.fr/ep13.mp3"/>
      </head><body></body></html>`.replace("—", "-");
    const { fetcher } = routedFetch({
      "https://indie.example.com/episodes/13": () =>
        new Response(latin1Bytes(page), { status: 200, headers: { "content-type": "text/html" } }),
      "https://cdn.example.fr/ep13.mp3": () => audioHead(),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://indie.example.com/episodes/13" },
      fetcher
    );
    expect(resolved.title).toBe("Épisode 13 - la dictée");
  });

  it("stops reading a feed body that streams past the cap", async () => {
    const { fetcher } = routedFetch({
      "https://podcast.example.fr/feed.xml": () =>
        new Response("<rss>".padEnd(5 * 1024 * 1024, "x"), {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        }),
    });
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://podcast.example.fr/feed.xml" }, fetcher)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "feed_too_large" });
  });
});

describe("resolveSource — episode page", () => {
  it("uses the page's own og:audio", async () => {
    const { fetcher } = routedFetch({
      "https://indie.example.com/episodes/12": () =>
        new Response(EPISODE_PAGE_WITH_AUDIO, { status: 200, headers: { "content-type": "text/html" } }),
      "https://indie.example.com/media/ep12.mp3": () => audioHead("audio/mpeg", 20_000_000),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://indie.example.com/episodes/12" },
      fetcher
    );
    expect(resolved.audio).toEqual({ kind: "url", url: "https://indie.example.com/media/ep12.mp3" });
    expect(resolved.title).toBe("Episode 12 — La dictée");
  });

  it("probes the highest-trust meta only, never an earlier decoy", async () => {
    const { fetcher, calls } = routedFetch({
      "https://indie.example.com/episodes/13": () =>
        new Response(EPISODE_PAGE_WITH_DECOY_META, { status: 200, headers: { "content-type": "text/html" } }),
      "https://cdn.example.com/right.mp3": () => audioHead("audio/mpeg", 18_000_000),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://indie.example.com/episodes/13" },
      fetcher
    );
    expect(resolved.resolvedUrl).toBe("https://cdn.example.com/right.mp3");
    expect(calls.map((call) => call.url)).toEqual([
      "https://indie.example.com/episodes/13",
      "https://cdn.example.com/right.mp3",
    ]);
  });

  it("falls back to the page's declared feed when the page embeds no audio", async () => {
    const pageWithOnlyFeed = `<!doctype html><html><head><title>Show</title>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml"/>
      </head><body></body></html>`;
    const { fetcher } = routedFetch({
      "https://indie.example.com/podcast": () =>
        new Response(pageWithOnlyFeed, { status: 200, headers: { "content-type": "text/html" } }),
      "https://indie.example.com/feed.xml": () => xml(RSS_FEED),
      "https://cdn.example.fr/ep42.mp3?token=abc&v=2": () => audioHead(),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://indie.example.com/podcast" },
      fetcher
    );
    expect(resolved.resolvedUrl).toBe("https://cdn.example.fr/ep42.mp3?token=abc&v=2");
  });
});

describe("resolveSource — Apple Podcasts", () => {
  const appleEpisodeLookup = JSON.stringify({
    resultCount: 1,
    results: [
      {
        wrapperType: "podcastEpisode",
        trackName: "Épisode 42 — L'imparfait",
        episodeGuid: "ep-42",
        episodeUrl: "https://cdn.example.fr/ep42.mp3?token=abc&v=2",
        feedUrl: "https://podcast.example.fr/feed.xml",
      },
    ],
  });

  const appleShowLookup = JSON.stringify({
    resultCount: 1,
    results: [
      {
        wrapperType: "track",
        collectionName: "Le Podcast des Profs",
        feedUrl: "https://podcast.example.fr/feed.xml",
      },
    ],
  });

  it("looks the show up in the iTunes API, then follows its feedUrl", async () => {
    const { fetcher, calls } = routedFetch({
      "https://itunes.apple.com/lookup?id=1234567890&entity=podcast": () =>
        new Response(appleShowLookup, { status: 200, headers: { "content-type": "text/javascript" } }),
      "https://podcast.example.fr/feed.xml": () => xml(RSS_FEED),
      "https://cdn.example.fr/ep42.mp3?token=abc&v=2": () => audioHead(),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://podcasts.apple.com/fr/podcast/les-profs/id1234567890" },
      fetcher
    );
    expect(resolved.resolvedUrl).toBe("https://cdn.example.fr/ep42.mp3?token=abc&v=2");
    expect(calls[0].url).toBe("https://itunes.apple.com/lookup?id=1234567890&entity=podcast");
  });

  it("uses the episode lookup's own episodeUrl when the link names an episode", async () => {
    const { fetcher, calls } = routedFetch({
      "https://itunes.apple.com/lookup?id=1000700000001&entity=podcastEpisode": () =>
        new Response(appleEpisodeLookup, { status: 200, headers: { "content-type": "text/javascript" } }),
      "https://cdn.example.fr/ep42.mp3?token=abc&v=2": () => audioHead(),
    });

    const resolved = await resolveSource(
      NO_ENV,
      {
        kind: "podcast",
        url: "https://podcasts.apple.com/fr/podcast/episode-42/id1234567890?i=1000700000001",
      },
      fetcher
    );
    expect(resolved.audio).toEqual({ kind: "url", url: "https://cdn.example.fr/ep42.mp3?token=abc&v=2" });
    expect(resolved.title).toBe("Épisode 42 — L'imparfait");
    // No feed fetch was needed: Apple already handed us the enclosure.
    expect(calls).toHaveLength(2);
  });

  it("matches the episode guid inside the feed when Apple gives no episodeUrl", async () => {
    const lookupWithoutAudio = JSON.stringify({
      resultCount: 1,
      results: [
        {
          trackName: "Épisode 40",
          episodeGuid: "ep-40",
          feedUrl: "https://podcast.example.fr/feed.xml",
        },
      ],
    });
    const { fetcher } = routedFetch({
      "https://itunes.apple.com/lookup?id=1000700000002&entity=podcastEpisode": () =>
        new Response(lookupWithoutAudio, { status: 200 }),
      "https://podcast.example.fr/feed.xml": () => xml(RSS_FEED),
      "https://cdn.example.fr/ep40.mp3": () => audioHead("audio/mpeg", 60_000_000),
    });

    const resolved = await resolveSource(
      NO_ENV,
      { kind: "podcast", url: "https://podcasts.apple.com/fr/podcast/x/id1234567890?i=1000700000002" },
      fetcher
    );
    expect(resolved.resolvedUrl).toBe("https://cdn.example.fr/ep40.mp3");
    expect(resolved.durationSeconds).toBe(3723);
  });

  it("reports no_audio_found when the lookup returns nothing", async () => {
    const { fetcher } = routedFetch({
      "https://itunes.apple.com/lookup?id=1234567890&entity=podcast": () =>
        new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 }),
    });
    const failure = await failureOf(
      resolveSource(
        NO_ENV,
        { kind: "podcast", url: "https://podcasts.apple.com/fr/podcast/x/id1234567890" },
        fetcher
      )
    );
    expect(failure).toEqual({ code: "no_audio_found", detail: "apple_lookup_empty" });
  });

  it("refuses a feedUrl from Apple that points somewhere private", async () => {
    const hostileLookup = JSON.stringify({
      resultCount: 1,
      results: [{ collectionName: "Hostile", feedUrl: "http://192.168.0.10/feed.xml" }],
    });
    const { fetcher } = routedFetch({
      "https://itunes.apple.com/lookup?id=1234567890&entity=podcast": () =>
        new Response(hostileLookup, { status: 200 }),
    });
    const failure = await failureOf(
      resolveSource(
        NO_ENV,
        { kind: "podcast", url: "https://podcasts.apple.com/fr/podcast/x/id1234567890" },
        fetcher
      )
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "blocked_host" });
  });
});

// ---------------------------------------------------------------------------
// resolveSource — the two typed refusals and uploads
// ---------------------------------------------------------------------------

describe("resolveSource — refusals", () => {
  it("refuses a YouTube reference with its own code, not a generic error", async () => {
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "youtube", url: "https://www.youtube.com/watch?v=abc" }, (() => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch)
    );
    expect(failure.code).toBe("youtube_not_yet_supported");
  });

  it("refuses a Spotify reference with its own code", async () => {
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "podcast", url: "https://open.spotify.com/episode/1a2b" }, (() => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch)
    );
    expect(failure.code).toBe("spotify_not_supported");
  });

  it("re-checks a persisted URL against today's guard", async () => {
    const failure = await failureOf(
      resolveSource(NO_ENV, { kind: "direct_url", url: "http://10.0.0.9/ep.mp3" }, (() => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "blocked_host" });
  });
});

describe("resolveSource — uploads", () => {
  const ref: TranscriptionSourceRef = {
    kind: "upload",
    r2Key: "transcription/job-1/cours.m4a",
    filename: "cours.m4a",
    contentType: "audio/mp4",
    bytes: 4_096,
  };

  it("reads the head, then hands the provider one Blob of the media", async () => {
    const { env, reads } = uploadEnv({ size: 4_096, contentType: "audio/mp4" });
    const resolved = await resolveSource(env, ref);
    expect(resolved.kind).toBe("upload");
    expect(resolved.r2Key).toBe("transcription/job-1/cours.m4a");
    expect(resolved.resolvedUrl).toBeNull();
    expect(resolved.title).toBe("cours");
    expect(resolved.audio.kind).toBe("bytes");
    if (resolved.audio.kind === "bytes") {
      expect(resolved.audio.contentType).toBe("audio/mp4");
      expect(resolved.audio.filename).toBe("cours.m4a");
      // The size comes from R2's metadata, not from touching the payload, and the
      // media itself is a Blob so nothing holds a second copy of it.
      expect(resolved.audio.sizeBytes).toBe(4_096);
      expect(resolved.audio.blob.size).toBeGreaterThan(0);
    }
    // Ranged read for the container header, then the whole object.
    expect(reads).toEqual([{ ranged: true }, { ranged: false }]);
  });

  it("refuses an upload the container header proves is over the cap", async () => {
    // A WAV whose own `fmt `/`data` chunks describe six hours of audio, in a file
    // whose byte count is small enough that no bound would have caught it.
    const { env } = uploadEnv({
      size: 4_096,
      contentType: "audio/wav",
      payload: wavHead(176_400 * 21_600),
    });
    const failure = await failureOf(
      resolveSource(env, { ...ref, contentType: "audio/wav", filename: "atelier.wav" })
    );
    expect(failure).toMatchObject({ code: "source_too_long", maxSeconds: 5_400 });
  });

  it("falls back to the R2 content type when the reference has none", async () => {
    const resolved = await resolveSource(uploadEnv({ size: 2_048, contentType: "audio/wav" }).env, {
      ...ref,
      contentType: null,
      filename: "dictee.wav",
    });
    expect(resolved.contentType).toBe("audio/wav");
  });

  it("infers the type from the filename when nothing declares one", async () => {
    const resolved = await resolveSource(uploadEnv({ size: 2_048, contentType: null }).env, {
      ...ref,
      contentType: null,
      filename: "dictee.flac",
    });
    expect(resolved.contentType).toBe("audio/flac");
  });

  it("refuses an upload over the byte ceiling", async () => {
    const failure = await failureOf(
      resolveSource(uploadEnv({ size: TRANSCRIPTION_MAX_UPLOAD_BYTES + 1, contentType: "audio/mp4" }).env, ref)
    );
    expect(failure).toEqual({
      code: "source_too_large",
      bytes: TRANSCRIPTION_MAX_UPLOAD_BYTES + 1,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    });
  });

  it("refuses a file that is not audio at all", async () => {
    const failure = await failureOf(
      resolveSource(uploadEnv({ size: 1_024, contentType: "application/pdf" }).env, {
        ...ref,
        contentType: "application/pdf",
        filename: "plan-de-cours.pdf",
      })
    );
    expect(failure).toEqual({ code: "unsupported_media_type", contentType: "application/pdf" });
  });

  it("treats a missing R2 object as our bug, not the teacher's", async () => {
    const failure = await failureOf(resolveSource(uploadEnv(null).env, ref));
    expect(failure).toEqual({ code: "internal", detail: "upload_missing" });
  });
});

// ---------------------------------------------------------------------------
// listPodcastEpisodes — the picker feed
// ---------------------------------------------------------------------------

describe("listPodcastEpisodes", () => {
  it("returns every playable episode of a feed so the UI can offer a choice", async () => {
    const { fetcher } = routedFetch({
      "https://podcast.example.fr/feed.xml": () => xml(RSS_FEED),
    });
    const feed = await listPodcastEpisodes(NO_ENV, "https://podcast.example.fr/feed.xml", fetcher);
    expect(feed.title).toBe("Le Podcast des Profs");
    expect(feed.episodes.map((episode) => episode.guid)).toEqual(["ep-42", "ep-40"]);
    expect(feed.feedUrl).toBe("https://podcast.example.fr/feed.xml");
  });

  it("goes through the iTunes lookup for an Apple link", async () => {
    const { fetcher } = routedFetch({
      "https://itunes.apple.com/lookup?id=1234567890&entity=podcast": () =>
        new Response(
          JSON.stringify({ resultCount: 1, results: [{ feedUrl: "https://podcast.example.fr/feed.xml" }] }),
          { status: 200 }
        ),
      "https://podcast.example.fr/feed.xml": () => xml(RSS_FEED),
    });
    const feed = await listPodcastEpisodes(
      NO_ENV,
      "https://podcasts.apple.com/fr/podcast/x/id1234567890",
      fetcher
    );
    expect(feed.episodes).toHaveLength(2);
  });

  it("refuses a YouTube link with its own code", async () => {
    const failure = await failureOf(
      listPodcastEpisodes(NO_ENV, "https://youtu.be/abc", (() => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch)
    );
    expect(failure.code).toBe("youtube_not_yet_supported");
  });

  it("refuses a direct audio URL — there is no episode list to show", async () => {
    const failure = await failureOf(
      listPodcastEpisodes(NO_ENV, "https://cdn.example.fr/ep.mp3", (() => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch)
    );
    expect(failure).toEqual({ code: "unsupported_source", detail: "not_a_podcast_url" });
  });
});
