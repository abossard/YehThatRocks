"use client";

import { useEffect, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { Top100VideoLink } from "@/components/top100-video-link";

export function NewVideosLoader({ initialVideos, isAuthenticated }: { initialVideos: VideoRecord[]; isAuthenticated: boolean }) {
  const [allVideos, setAllVideos] = useState(initialVideos);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRemaining = async () => {
      try {
        const response = await fetch(`/api/videos/newest?skip=10&take=90`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (response.ok) {
          const { videos } = (await response.json()) as { videos: VideoRecord[] };
          setAllVideos((prev) => [...prev, ...videos]);
        }
      } catch (error) {
        console.error("Failed to load remaining videos:", error);
      } finally {
        setLoading(false);
      }
    };

    // Start fetch immediately, don't wait for render
    void loadRemaining();
  }, []);

  return (
    <div className="trackStack spanTwoColumns">
      {allVideos.map((track, index) => (
        <Top100VideoLink key={track.id} track={track} index={index} isAuthenticated={isAuthenticated} />
      ))}
      {loading && allVideos.length === initialVideos.length && (
        <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>Loading more videos...</div>
      )}
    </div>
  );
}
