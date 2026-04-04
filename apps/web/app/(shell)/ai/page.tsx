import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { getAiTracks } from "@/lib/catalog-data";

export default async function AiPage() {
  const tracks = await getAiTracks();

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whiteAiGlyph" aria-hidden="true">🤖</span> AI tracks</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span><span className="whiteAiGlyph" aria-hidden="true">🤖</span> AI library</span>
          <strong>Seeded tracks for the future dedicated section</strong>
        </div>
        <div className="catalogGrid">
          {tracks.map((track) => (
            <Link key={track.id} href={`/ai/${track.id}`} className="catalogCard linkedCard aiTrackCard">
              <p className="statusLabel">{track.tool}</p>
              <h3>{track.title}</h3>
              <p>{track.genre}</p>
              <p>Score {track.score} · {track.playCount.toLocaleString()} plays</p>
              <p className="promptPreview">{track.prompt}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

