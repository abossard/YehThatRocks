"use client";

import { useEffect, useMemo, useState } from "react";

type DashboardPayload = {
  meta: { durationMs: number; generatedAt: string };
  health: {
    nodeUptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
    host: {
      platform: string;
      loadAvg: number[];
      totalMemMb: number;
      freeMemMb: number;
      cpuUsagePercent: number | null;
      memoryUsagePercent: number;
      networkUsagePercent: number | null;
    };
  };
  counts: { users: number; videos: number; artists: number; categories: number };
  locations: Array<{ location: string; count: number }>;
  traffic: Array<{ day: string; count: number }>;
};

type CategoryRow = { id: number; genre: string; thumbnailVideoId: string | null; updatedAt: string };
type VideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  channelTitle: string | null;
  updatedAt: string | null;
};
type ArtistRow = {
  id: number;
  name: string;
  country: string | null;
  genre1: string | null;
  genre2: string | null;
  genre3: string | null;
  genre4: string | null;
  genre5: string | null;
  genre6: string | null;
};

export type AdminTab = "overview" | "categories" | "videos" | "artists";

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function Dial({ label, value, color }: { label: string; value: number | null; color: string }) {
  const radius = 34;
  const stroke = 8;
  const size = 90;
  const circumference = 2 * Math.PI * radius;
  const safeValue = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - safeValue / 100);

  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${value === null ? "n/a" : `${Math.round(safeValue)} percent`}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="#fff" style={{ fontSize: 14, fontWeight: 700 }}>
          {value === null ? "n/a" : `${Math.round(safeValue)}%`}
        </text>
      </svg>
      <span className="authMessage" style={{ margin: 0 }}>{label}</span>
    </div>
  );
}

export function AdminDashboardPanel({ activeTab }: { activeTab: AdminTab }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [artists, setArtists] = useState<ArtistRow[]>([]);

  const [videoQuery, setVideoQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const selectedLocations = useMemo(() => dashboard?.locations.slice(0, 10) ?? [], [dashboard]);
  const orderedTraffic = useMemo(() => (dashboard?.traffic ?? []).slice().reverse(), [dashboard]);
  const maxTrafficCount = useMemo(() => Math.max(1, ...orderedTraffic.map((item) => item.count)), [orderedTraffic]);
  const maxLocationCount = useMemo(() => Math.max(1, ...selectedLocations.map((item) => item.count)), [selectedLocations]);
  const trafficGraph = useMemo(() => {
    const width = 680;
    const height = 220;
    const padding = 24;

    if (orderedTraffic.length === 0) {
      return { width, height, points: [], path: "" };
    }

    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const step = orderedTraffic.length > 1 ? chartWidth / (orderedTraffic.length - 1) : 0;

    const points = orderedTraffic.map((item, index) => {
      const x = padding + index * step;
      const y = padding + chartHeight - (item.count / maxTrafficCount) * chartHeight;
      return { x, y, day: item.day, count: item.count };
    });

    const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

    return { width, height, points, path };
  }, [orderedTraffic, maxTrafficCount]);

  async function loadAll() {
    setLoading(true);
    setError(null);

    try {
      const [dashboardPayload, categoryPayload, videoPayload, artistPayload] = await Promise.all([
        readJson<DashboardPayload>("/api/admin/dashboard"),
        readJson<{ categories: CategoryRow[] }>("/api/admin/categories"),
        readJson<{ videos: VideoRow[] }>(`/api/admin/videos${videoQuery ? `?q=${encodeURIComponent(videoQuery)}` : ""}`),
        readJson<{ artists: ArtistRow[] }>(`/api/admin/artists${artistQuery ? `?q=${encodeURIComponent(artistQuery)}` : ""}`),
      ]);

      setDashboard(dashboardPayload);
      setCategories(categoryPayload.categories);
      setVideos(videoPayload.videos);
      setArtists(artistPayload.artists);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function patchJson(url: string, body: Record<string, unknown>) {
    await readJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function saveCategory(row: CategoryRow) {
    try {
      await patchJson("/api/admin/categories", row);
      setSaveMessage(`Saved category ${row.genre}.`);
      await loadAll();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Category save failed.");
    }
  }

  async function saveVideo(row: VideoRow) {
    try {
      await patchJson("/api/admin/videos", row);
      setSaveMessage(`Saved video ${row.videoId}.`);
      await loadAll();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Video save failed.");
    }
  }

  async function saveArtist(row: ArtistRow) {
    try {
      await patchJson("/api/admin/artists", row);
      setSaveMessage(`Saved artist ${row.name}.`);
      await loadAll();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Artist save failed.");
    }
  }

  if (loading) {
    return <p className="authMessage">Loading admin dashboard...</p>;
  }

  if (error) {
    return <p className="authMessage">{error}</p>;
  }

  return (
    <div className="interactiveStack">
      {saveMessage ? <p className="authMessage">{saveMessage}</p> : null}

      {activeTab === "overview" ? (
        <>
          <section className="panel featurePanel">
            <div className="panelHeading">
              <span>Server Health</span>
              <strong>{dashboard?.meta.generatedAt ?? "n/a"}</strong>
            </div>
            <p className="authMessage">
              Node uptime: {dashboard?.health.nodeUptimeSec ?? 0}s | RSS: {dashboard?.health.memory.rssMb ?? 0}MB | Heap: {dashboard?.health.memory.heapUsedMb ?? 0}/{dashboard?.health.memory.heapTotalMb ?? 0}MB
            </p>
            <p className="authMessage">
              Host: {dashboard?.health.host.platform ?? "n/a"} | Free memory: {dashboard?.health.host.freeMemMb ?? 0}/{dashboard?.health.host.totalMemMb ?? 0}MB | Load avg: {(dashboard?.health.host.loadAvg ?? []).join(", ")}
            </p>
            <div className="statusMetrics">
              <div><strong>Users</strong><p>{dashboard?.counts.users ?? 0}</p></div>
              <div><strong>Videos</strong><p>{dashboard?.counts.videos ?? 0}</p></div>
              <div><strong>Artists</strong><p>{dashboard?.counts.artists ?? 0}</p></div>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
              <Dial label="Memory" value={dashboard?.health.host.memoryUsagePercent ?? null} color="#ffc14d" />
              <Dial label="CPU" value={dashboard?.health.host.cpuUsagePercent ?? null} color="#ff6f43" />
              <Dial label="Network" value={dashboard?.health.host.networkUsagePercent ?? null} color="#5fc1ff" />
            </div>
          </section>

          <section className="panel featurePanel">
            <div className="panelHeading">
              <span>Traffic Visual (Auth Events)</span>
              <strong>Last {orderedTraffic.length} days</strong>
            </div>
            <div className="interactiveStack">
              {trafficGraph.points.length > 0 ? (
                <svg
                  viewBox={`0 0 ${trafficGraph.width} ${trafficGraph.height}`}
                  role="img"
                  aria-label="Traffic trend chart"
                  style={{ width: "100%", height: "auto", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}
                >
                  <line x1="24" y1="24" x2="24" y2={String(trafficGraph.height - 24)} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
                  <line x1="24" y1={String(trafficGraph.height - 24)} x2={String(trafficGraph.width - 24)} y2={String(trafficGraph.height - 24)} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
                  <path d={trafficGraph.path} fill="none" stroke="#ff6f43" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  {trafficGraph.points.map((point) => (
                    <g key={point.day}>
                      <circle cx={point.x} cy={point.y} r="3.6" fill="#ffd1c4" />
                      <title>{`${point.day}: ${point.count}`}</title>
                    </g>
                  ))}
                </svg>
              ) : (
                <p className="authMessage">No traffic data available.</p>
              )}
              <div className="authMessage">Peak daily events: {maxTrafficCount}</div>
            </div>
          </section>

          <section className="panel featurePanel">
            <div className="panelHeading">
              <span>User Location Visual</span>
              <strong>Top {selectedLocations.length}</strong>
            </div>
            <div className="interactiveStack">
              {selectedLocations.map((item) => (
                <div key={item.location}>
                  <p className="authMessage">{item.location}: {item.count}</p>
                  <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 8, height: 10, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.max(3, Math.round((item.count / maxLocationCount) * 100))}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #ffc14d, #a35b08)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {activeTab === "categories" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Edit Categories</span>
            <strong>{categories.length} rows</strong>
          </div>
          <div className="interactiveStack">
            {categories.slice(0, 30).map((row) => (
              <div key={row.id} className="authForm">
                <label>
                  <span>Genre</span>
                  <input
                    value={row.genre}
                    onChange={(event) => {
                      const next = categories.map((item) => (item.id === row.id ? { ...item, genre: event.target.value } : item));
                      setCategories(next);
                    }}
                  />
                </label>
                <label>
                  <span>Thumbnail Video ID</span>
                  <input
                    value={row.thumbnailVideoId ?? ""}
                    onChange={(event) => {
                      const next = categories.map((item) => (
                        item.id === row.id ? { ...item, thumbnailVideoId: event.target.value || null } : item
                      ));
                      setCategories(next);
                    }}
                  />
                </label>
                <button type="button" onClick={() => void saveCategory(row)}>Save Category</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "videos" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Edit Videos</span>
            <strong>{videos.length} rows</strong>
          </div>
          <div className="interactiveStack">
            <label>
              <span>Search</span>
              <input value={videoQuery} onChange={(event) => setVideoQuery(event.target.value)} placeholder="videoId, title, artist, track" />
            </label>
            <button type="button" onClick={() => void loadAll()}>Refresh Video Search</button>
            {videos.slice(0, 25).map((row) => (
              <div key={row.id} className="authForm">
                <p className="authMessage">{row.videoId}</p>
                <label>
                  <span>Title</span>
                  <input
                    value={row.title}
                    onChange={(event) => {
                      const next = videos.map((item) => (item.id === row.id ? { ...item, title: event.target.value } : item));
                      setVideos(next);
                    }}
                  />
                </label>
                <label>
                  <span>Artist</span>
                  <input
                    value={row.parsedArtist ?? ""}
                    onChange={(event) => {
                      const next = videos.map((item) => (item.id === row.id ? { ...item, parsedArtist: event.target.value || null } : item));
                      setVideos(next);
                    }}
                  />
                </label>
                <label>
                  <span>Track</span>
                  <input
                    value={row.parsedTrack ?? ""}
                    onChange={(event) => {
                      const next = videos.map((item) => (item.id === row.id ? { ...item, parsedTrack: event.target.value || null } : item));
                      setVideos(next);
                    }}
                  />
                </label>
                <button type="button" onClick={() => void saveVideo(row)}>Save Video</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "artists" ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Edit Artists</span>
            <strong>{artists.length} rows</strong>
          </div>
          <div className="interactiveStack">
            <label>
              <span>Search</span>
              <input value={artistQuery} onChange={(event) => setArtistQuery(event.target.value)} placeholder="artist, country, genre" />
            </label>
            <button type="button" onClick={() => void loadAll()}>Refresh Artist Search</button>
            {artists.slice(0, 25).map((row) => (
              <div key={row.id} className="authForm">
                <label>
                  <span>Name</span>
                  <input
                    value={row.name}
                    onChange={(event) => {
                      const next = artists.map((item) => (item.id === row.id ? { ...item, name: event.target.value } : item));
                      setArtists(next);
                    }}
                  />
                </label>
                <label>
                  <span>Country</span>
                  <input
                    value={row.country ?? ""}
                    onChange={(event) => {
                      const next = artists.map((item) => (item.id === row.id ? { ...item, country: event.target.value || null } : item));
                      setArtists(next);
                    }}
                  />
                </label>
                <label>
                  <span>Genre 1</span>
                  <input
                    value={row.genre1 ?? ""}
                    onChange={(event) => {
                      const next = artists.map((item) => (item.id === row.id ? { ...item, genre1: event.target.value || null } : item));
                      setArtists(next);
                    }}
                  />
                </label>
                <button type="button" onClick={() => void saveArtist(row)}>Save Artist</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
