export function slugifyArtistName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getArtistPagePath(artistName: string) {
  const slug = slugifyArtistName(artistName);
  return slug ? `/artist/${encodeURIComponent(slug)}` : null;
}

export function getArtistWikiPath(artistName: string) {
  const slug = slugifyArtistName(artistName);
  return slug ? `/artist/${encodeURIComponent(slug)}/wiki` : null;
}

export function withVideoContext(path: string, videoId?: string | null, resume = true) {
  if (!videoId) {
    return path;
  }

  const params = new URLSearchParams();
  params.set("v", videoId);
  if (resume) {
    params.set("resume", "1");
  }

  return `${path}?${params.toString()}`;
}
