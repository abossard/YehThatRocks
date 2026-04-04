import { notFound } from "next/navigation";

import { AiVoteControls } from "@/components/ai-vote-controls";
import { CloseLink } from "@/components/close-link";
import { getAiTrackById } from "@/lib/catalog-data";

type AiTrackDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AiTrackDetailPage({ params }: AiTrackDetailPageProps) {
  const { id } = await params;
  const track = await getAiTrackById(id);

  if (!track) {
    notFound();
  }

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>AI track</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>AI player</span>
          <strong>Dedicated audio-mode route</strong>
        </div>
        <div className="catalogCard aiDetailCard">
          <p className="statusLabel">{track.tool}</p>
          <h3>{track.genre}</h3>
          <p>
            Score {track.score} · {track.playCount.toLocaleString()} plays
          </p>
          <div className="audioPlaceholder">
            <strong>HTML5 audio player lands here</strong>
            <p>This page is separated from YouTube playback on purpose to preserve the AI section contract.</p>
          </div>
        </div>
      </section>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Prompt transparency</span>
          <strong>Generation context</strong>
        </div>
        <div className="catalogCard aiDetailCard">
          <p className="promptPreview">{track.prompt}</p>
          <AiVoteControls trackId={track.id} />
          <div className="routeContractRow">
            <a href={`/api/ai/${track.id}`} className="navLink">
              View JSON Endpoint
            </a>
            <span className="contractHint">
              POST to <code>/api/ai/{track.id}/vote</code> with <code>{'{"vote":1}'}</code> or <code>{'{"vote":-1}'}</code>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}