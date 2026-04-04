import Image from "next/image";
import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { getTopVideos } from "@/lib/catalog-data";

function getLeaderboardThumbnail(track: { id: string; thumbnail?: string | null }) {
  const thumbnail = track.thumbnail?.trim();
  return thumbnail && thumbnail.length > 0
    ? thumbnail
    : `https://i.ytimg.com/vi/${encodeURIComponent(track.id)}/mqdefault.jpg`;
}

export default async function TopHundredPage() {
  const topVideos = await getTopVideos(100);

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Top 100</strong>
        <CloseLink />
      </div>

      <div className="trackStack spanTwoColumns">
        {topVideos.map((track, index) => (
          <Link key={track.id} href={`/?v=${track.id}`} className="trackCard linkedCard leaderboardCard">
            <div className="leaderboardRank">#{index + 1}</div>
            <div className="leaderboardThumbWrap">
              <Image
                src={getLeaderboardThumbnail(track)}
                alt=""
                width={160}
                height={90}
                className="leaderboardThumb"
                loading="lazy"
              />
            </div>
            <div className="leaderboardMeta">
              <h3>{track.title}</h3>
              <p>
                {track.channelTitle} · {track.favourited.toLocaleString()} favourites
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
