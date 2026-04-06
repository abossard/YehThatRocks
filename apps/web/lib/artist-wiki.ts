import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getVideosByArtist } from "@/lib/catalog-data";
import { slugifyArtistName } from "@/lib/artist-routing";

const WIKI_CACHE_VERSION = 3;
const WIKI_CACHE_DIR = path.join(process.cwd(), ".cache", "artist-wiki");

type GroqMessage = {
  role: "system" | "user";
  content: string;
};

type GroqCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ExternalSource = {
  title: string;
  url: string;
  snippet: string;
  imageUrl?: string;
};

type ArtistWikiImage = {
  url: string;
  title: string;
  sourceUrl: string;
};

type MusicBrainzArtist = {
  id?: string;
  name?: string;
  country?: string;
  disambiguation?: string;
  score?: number;
  "life-span"?: {
    begin?: string;
    end?: string;
    ended?: boolean;
  };
};

type ArtistWikiSections = {
  overview: string;
  formationAndBackstory: string;
  styleAndInfluences: string;
  members: {
    current: string[];
    former: string[];
    notes: string;
  };
  discography: {
    studioAlbums: string[];
    liveAlbums: string[];
    epsAndCompilations: string[];
    notableTracks: string[];
  };
  legacyAndNotes: string;
  futureEnhancements: {
    wallpapers: string;
    merchandise: string;
  };
};

export type ArtistWikiDocument = {
  version: number;
  artistName: string;
  slug: string;
  generatedAt: string;
  model: string;
  sections: ArtistWikiSections;
  images: ArtistWikiImage[];
  sources: Array<{ title: string; url: string }>;
};

function normalizeImageUrl(value: unknown) {
  const candidate = trimText(value);
  if (!candidate) {
    return "";
  }

  if (!/^https?:\/\//i.test(candidate)) {
    return "";
  }

  // Low-quality TIFF conversion preview URLs frequently break in embeds.
  if (/lossy-page\d+.*\.tif/i.test(candidate)) {
    return "";
  }

  return candidate;
}

function buildYouTubeThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function isLikelyWikipediaMatch(artistName: string, pageTitle: string) {
  const artistSlug = slugifyArtistName(artistName);
  const titleSlug = slugifyArtistName(pageTitle);

  if (!artistSlug || !titleSlug) {
    return false;
  }

  return titleSlug.includes(artistSlug) || artistSlug.includes(titleSlug);
}

function trimText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeList(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, maxItems);
}

function extractFirstJsonObject(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  return candidate.slice(start, end + 1);
}

function sanitizeWikiDocument(artistName: string, slug: string, model: string, candidate: unknown, fallbackSources: ExternalSource[]): ArtistWikiDocument {
  const safe = (candidate && typeof candidate === "object" ? candidate : {}) as Record<string, unknown>;
  const sectionsRaw = (safe.sections && typeof safe.sections === "object" ? safe.sections : {}) as Record<string, unknown>;
  const membersRaw = (sectionsRaw.members && typeof sectionsRaw.members === "object" ? sectionsRaw.members : {}) as Record<string, unknown>;
  const discographyRaw = (sectionsRaw.discography && typeof sectionsRaw.discography === "object" ? sectionsRaw.discography : {}) as Record<string, unknown>;
  const futureRaw = (sectionsRaw.futureEnhancements && typeof sectionsRaw.futureEnhancements === "object" ? sectionsRaw.futureEnhancements : {}) as Record<string, unknown>;

  const sourceCandidates = Array.isArray(safe.sources) ? safe.sources : [];
  const sources = sourceCandidates
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const source = item as Record<string, unknown>;
      const title = trimText(source.title);
      const url = trimText(source.url);

      if (!title || !url) {
        return null;
      }

      return { title, url };
    })
    .filter((item): item is { title: string; url: string } => Boolean(item));

  const normalizedSources = sources.length > 0
    ? sources.slice(0, 8)
    : fallbackSources.slice(0, 8).map((item) => ({ title: item.title, url: item.url }));

  const imageCandidates = Array.isArray(safe.images) ? safe.images : [];
  const explicitImages = imageCandidates
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const image = item as Record<string, unknown>;
      const url = normalizeImageUrl(image.url);

      if (!url) {
        return null;
      }

      return {
        url,
        title: trimText(image.title, artistName),
        sourceUrl: trimText(image.sourceUrl, normalizedSources[0]?.url || ""),
      };
    })
    .filter((item): item is ArtistWikiImage => Boolean(item));

  const fallbackImages = fallbackSources
    .map((source) => {
      const imageUrl = normalizeImageUrl(source.imageUrl);
      if (!imageUrl) {
        return null;
      }

      return {
        url: imageUrl,
        title: source.title,
        sourceUrl: source.url,
      };
    })
    .filter((item): item is ArtistWikiImage => Boolean(item));

  const mergedImages = [...explicitImages, ...fallbackImages];
  const dedupedImages: ArtistWikiImage[] = [];
  const seenImageUrls = new Set<string>();

  for (const image of mergedImages) {
    if (seenImageUrls.has(image.url)) {
      continue;
    }

    seenImageUrls.add(image.url);
    dedupedImages.push(image);

    if (dedupedImages.length >= 6) {
      break;
    }
  }

  return {
    version: WIKI_CACHE_VERSION,
    artistName,
    slug,
    generatedAt: new Date().toISOString(),
    model,
    images: dedupedImages,
    sections: {
      overview: trimText(sectionsRaw.overview, `${artistName} is a notable artist in rock and metal culture.`),
      formationAndBackstory: trimText(sectionsRaw.formationAndBackstory, "Formation and backstory details are still being verified."),
      styleAndInfluences: trimText(sectionsRaw.styleAndInfluences, "Style and influence information is currently being expanded."),
      members: {
        current: normalizeList(membersRaw.current, 16),
        former: normalizeList(membersRaw.former, 16),
        notes: trimText(membersRaw.notes, "Membership records can vary across sources; treat this as a living summary."),
      },
      discography: {
        studioAlbums: normalizeList(discographyRaw.studioAlbums, 25),
        liveAlbums: normalizeList(discographyRaw.liveAlbums, 15),
        epsAndCompilations: normalizeList(discographyRaw.epsAndCompilations, 20),
        notableTracks: normalizeList(discographyRaw.notableTracks, 20),
      },
      legacyAndNotes: trimText(sectionsRaw.legacyAndNotes, "Legacy notes are being assembled from verified public references."),
      futureEnhancements: {
        wallpapers: trimText(
          futureRaw.wallpapers,
          "Downloadable wallpapers and media packs can be added in a future update.",
        ),
        merchandise: trimText(
          futureRaw.merchandise,
          "Official merchandise affiliate links can be integrated here in a future release.",
        ),
      },
    },
    sources: normalizedSources,
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "YehThatRocksWikiBot/1.0",
      },
      cache: "force-cache",
    });

    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWikipediaSource(artistName: string): Promise<ExternalSource | null> {
  try {
    const searchResponse = await fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(artistName)}&limit=1&namespace=0&format=json`,
      4500,
    );

    if (!searchResponse.ok) {
      return null;
    }

    const searchPayload = (await searchResponse.json().catch(() => null)) as unknown[] | null;
    const titles = Array.isArray(searchPayload?.[1]) ? (searchPayload?.[1] as string[]) : [];
    const urls = Array.isArray(searchPayload?.[3]) ? (searchPayload?.[3] as string[]) : [];

    if (!titles[0] || !urls[0]) {
      return null;
    }

    if (!isLikelyWikipediaMatch(artistName, titles[0])) {
      return null;
    }

    const summaryResponse = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0])}`,
      4500,
    );

    if (!summaryResponse.ok) {
      return {
        title: `Wikipedia: ${titles[0]}`,
        url: urls[0],
        snippet: "Wikipedia page discovered.",
      };
    }

    const summaryPayload = (await summaryResponse.json().catch(() => null)) as {
      extract?: string;
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    } | null;

    const summaryImage = normalizeImageUrl(summaryPayload?.originalimage?.source)
      || normalizeImageUrl(summaryPayload?.thumbnail?.source)
      || undefined;

    return {
      title: `Wikipedia: ${titles[0]}`,
      url: urls[0],
      snippet: trimText(summaryPayload?.extract, "Wikipedia summary unavailable."),
      imageUrl: summaryImage,
    };
  } catch {
    return null;
  }
}

async function fetchMusicBrainzSource(artistName: string): Promise<ExternalSource | null> {
  try {
    const response = await fetchWithTimeout(
      `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:${artistName}`)}&fmt=json&limit=1`,
      4500,
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as { artists?: MusicBrainzArtist[] } | null;
    const artist = payload?.artists?.[0];

    if (!artist?.id) {
      return null;
    }

    const years = [artist["life-span"]?.begin, artist["life-span"]?.end].filter(Boolean).join(" - ");
    const snippetParts = [
      trimText(artist.name, artistName),
      trimText(artist.country, ""),
      trimText(artist.disambiguation, ""),
      years,
    ].filter(Boolean);

    return {
      title: `MusicBrainz: ${trimText(artist.name, artistName)}`,
      url: `https://musicbrainz.org/artist/${artist.id}`,
      snippet: snippetParts.join(" | "),
    };
  } catch {
    return null;
  }
}

async function fetchCatalogSource(artistName: string): Promise<ExternalSource | null> {
  try {
    const videos = await getVideosByArtist(artistName);
    const firstVideo = videos.find((video) => Boolean(video?.id));

    if (!firstVideo?.id) {
      return null;
    }

    return {
      title: `YehThatRocks: ${artistName}`,
      url: `https://yehthatrocks.com/?v=${encodeURIComponent(firstVideo.id)}`,
      snippet: trimText(firstVideo.title, `Top track snapshot for ${artistName}`),
      imageUrl: buildYouTubeThumbnail(firstVideo.id),
    };
  } catch {
    return null;
  }
}

async function collectSources(artistName: string) {
  const [catalog, wikipedia, musicBrainz] = await Promise.all([
    fetchCatalogSource(artistName),
    fetchWikipediaSource(artistName),
    fetchMusicBrainzSource(artistName),
  ]);

  return [catalog, wikipedia, musicBrainz].filter((item): item is ExternalSource => Boolean(item));
}

async function generateWikiDocument(artistName: string, slug: string): Promise<ArtistWikiDocument> {
  const sources = await collectSources(artistName);

  const sourceDigest = sources.length > 0
    ? sources
      .map((source, index) => `${index + 1}. ${source.title}\nURL: ${source.url}\nNotes: ${source.snippet}`)
      .join("\n\n")
    : "No external source snippets were available at generation time.";

  const systemPrompt = [
    "You are writing a structured artist wiki for a rock/metal platform.",
    "Use only the supplied source notes and clearly cautious inferences.",
    "If uncertain, explicitly say unknown rather than inventing facts.",
    "Return strict JSON with this exact structure:",
    "{",
    '  "sections": {',
    '    "overview": "...",',
    '    "formationAndBackstory": "...",',
    '    "styleAndInfluences": "...",',
    '    "members": { "current": ["..."], "former": ["..."], "notes": "..." },',
    '    "discography": {',
    '      "studioAlbums": ["..."] ,',
    '      "liveAlbums": ["..."],',
    '      "epsAndCompilations": ["..."],',
    '      "notableTracks": ["..."]',
    "    },",
    '    "legacyAndNotes": "...",',
    '    "futureEnhancements": {',
    '      "wallpapers": "...",',
    '      "merchandise": "..."',
    "    }",
    "  },",
    '  "images": [{ "url": "https://...", "title": "...", "sourceUrl": "https://..." }],',
    '  "sources": [{ "title": "...", "url": "..." }]',
    "}",
  ].join("\n");

  const userPrompt = [
    `Artist: ${artistName}`,
    "Audience: fans looking for concise but informative context.",
    "Tone: factual, neutral, no hype, no fan-fiction.",
    "Limit each narrative section to 2-5 short paragraphs.",
    "Discography lists should prioritise major notable releases; use year prefixes when known.",
    "Source notes:",
    sourceDigest,
  ].join("\n\n");

  const messages: GroqMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const apiKey = process.env.GROQ_API_KEY?.trim();
  let model = "fallback/offline";
  let parsedPayload: unknown = null;

  if (apiKey) {
    const modelsToTry = ["openai/gpt-oss-120b", "gpt-oss-120b"];

    for (const candidateModel of modelsToTry) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: candidateModel,
            temperature: 0.2,
            messages,
          }),
        });

        if (!response.ok) {
          continue;
        }

        const completion = (await response.json().catch(() => null)) as GroqCompletionResponse | null;
        const content = completion?.choices?.[0]?.message?.content;

        if (!content) {
          continue;
        }

        const jsonText = extractFirstJsonObject(content);

        if (!jsonText) {
          continue;
        }

        parsedPayload = JSON.parse(jsonText);
        model = candidateModel;
        break;
      } catch {
        // Fall through to next candidate model.
      }
    }
  }

  return sanitizeWikiDocument(artistName, slug, model, parsedPayload, sources);
}

function getWikiCacheFile(slug: string) {
  return path.join(WIKI_CACHE_DIR, `${slug}.json`);
}

async function readCachedWiki(slug: string): Promise<ArtistWikiDocument | null> {
  try {
    const raw = await readFile(getWikiCacheFile(slug), "utf-8");
    const parsed = JSON.parse(raw) as ArtistWikiDocument;

    if (!parsed || parsed.version !== WIKI_CACHE_VERSION) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function writeCachedWiki(slug: string, wiki: ArtistWikiDocument) {
  await mkdir(WIKI_CACHE_DIR, { recursive: true });

  const finalPath = getWikiCacheFile(slug);
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(wiki, null, 2), "utf-8");
  await rename(tempPath, finalPath);
}

export async function getOrCreateArtistWiki(artistName: string, slugHint?: string) {
  const slug = slugHint && slugHint.trim() ? slugHint.trim() : slugifyArtistName(artistName);

  if (!slug) {
    return null;
  }

  const cached = await readCachedWiki(slug);

  if (cached) {
    return cached;
  }

  const generated = await generateWikiDocument(artistName, slug);
  await writeCachedWiki(slug, generated);
  return generated;
}
