export type VideoRecord = {
  id: string;
  title: string;
  channelTitle: string;
  genre: string;
  favourited: number;
  description: string;
};

export type ArtistRecord = {
  name: string;
  slug: string;
  country: string;
  genre: string;
};

export type AiTrackRecord = {
  id: string;
  title: string;
  tool: string;
  genre: string;
  playCount: number;
  score: number;
  prompt: string;
};

export const videos: VideoRecord[] = [
  {
    id: "3YxaaGgTQYM",
    title: "Evanescence - Bring Me To Life",
    channelTitle: "Evanescence",
    genre: "Gothic Metal",
    favourited: 9821,
    description:
      "Legacy-compatible deep-link sample used to stand in for the primary player route."
  },
  {
    id: "v-Su1YXQYek",
    title: "Mastodon - Blood and Thunder",
    channelTitle: "Mastodon",
    genre: "Sludge Metal",
    favourited: 8644,
    description: "Top 100 calibre track that drives autoplay and watch-next mocks."
  },
  {
    id: "SU1apJTv94o",
    title: "Gojira - Stranded",
    channelTitle: "Gojira",
    genre: "Progressive Groove Metal",
    favourited: 8120,
    description: "A heavy modern flagship track for the player queue state."
  },
  {
    id: "47e_961OQWE",
    title: "Nightwish - Ghost Love Score",
    channelTitle: "Nightwish",
    genre: "Symphonic Metal",
    favourited: 7784,
    description: "Share-ready long-form epic used in the related rail and favourites previews."
  },
  {
    id: "iPW9AbRMwFU",
    title: "Killswitch Engage - My Curse",
    channelTitle: "Killswitch Engage",
    genre: "Metalcore",
    favourited: 7422,
    description: "High-energy fallback track for category and search surfaces."
  }
];

export const genres = [
  "Alternative",
  "Black Metal",
  "Deathcore",
  "Doom",
  "Gothic",
  "Industrial",
  "Metalcore",
  "Nu Metal",
  "Power Metal",
  "Progressive Metal",
  "Symphonic Metal",
  "Thrash Metal"
];

export const artists: ArtistRecord[] = [
  { name: "Gojira", slug: "gojira", country: "France", genre: "Progressive Metal" },
  { name: "Mastodon", slug: "mastodon", country: "United States", genre: "Sludge Metal" },
  { name: "Nightwish", slug: "nightwish", country: "Finland", genre: "Symphonic Metal" },
  { name: "Katatonia", slug: "katatonia", country: "Sweden", genre: "Gothic Metal" },
  { name: "Opeth", slug: "opeth", country: "Sweden", genre: "Progressive Metal" }
];

export const aiTracks: AiTrackRecord[] = [
  {
    id: "iron-horizon",
    title: "Iron Horizon",
    tool: "Suno",
    genre: "Power Metal",
    playCount: 1242,
    score: 88,
    prompt: "anthemic power metal with choirs, double-kick drums, and soaring lead guitar"
  },
  {
    id: "ashen-cathedral",
    title: "Ashen Cathedral",
    tool: "Udio",
    genre: "Gothic Metal",
    playCount: 914,
    score: 74,
    prompt: "slow gothic metal with cathedral organ, deep toms, and a massive chorus"
  },
  {
    id: "fracture-engine",
    title: "Fracture Engine",
    tool: "Other",
    genre: "Industrial Metal",
    playCount: 1506,
    score: 91,
    prompt: "industrial metal with mechanical percussion, syncopated riffs, and harsh vocals"
  }
];

export const chatMessages = [
  {
    user: "MetalFan204",
    text: "Global and per-video chat stay visible while the player changes route state.",
    room: "Global"
  },
  {
    user: "DoomScout",
    text: "The new shell keeps one-click favourites, share, and next-track actions near the player.",
    room: "Video"
  },
  {
    user: "RiffMiner",
    text: "Categories, artists, and top tracks now have route-level pages instead of a single splash screen.",
    room: "Global"
  }
];

export const navItems = [
  { href: "/", label: "Home" },
  { href: "/categories", label: "Categories" },
  { href: "/artists", label: "Artists" },
  { href: "/top100", label: "Top 100" },
  { href: "/favourites", label: "Favourites" },
  { href: "/playlists", label: "Playlists" },
  { href: "/ai", label: "AI" },
  { href: "/account", label: "Account" }
];

export function getVideoById(id?: string) {
  return videos.find((video) => video.id === id) ?? videos[0];
}

export function getRelatedVideos(currentId: string) {
  return videos.filter((video) => video.id !== currentId).slice(0, 3);
}

export function getArtistBySlug(slug: string) {
  return artists.find((artist) => artist.slug === slug);
}

export function searchCatalog(query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return {
      videos: videos.slice(0, 4),
      artists: artists.slice(0, 4),
      genres: genres.slice(0, 6)
    };
  }

  return {
    videos: videos.filter((video) => {
      return [video.title, video.channelTitle, video.genre].some((value) =>
        value.toLowerCase().includes(normalized)
      );
    }),
    artists: artists.filter((artist) => {
      return [artist.name, artist.genre, artist.country].some((value) =>
        value.toLowerCase().includes(normalized)
      );
    }),
    genres: genres.filter((genre) => genre.toLowerCase().includes(normalized))
  };
}
