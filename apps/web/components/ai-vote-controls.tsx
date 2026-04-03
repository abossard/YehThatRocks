"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AiVoteControlsProps = {
  trackId: string;
};

export function AiVoteControls({ trackId }: AiVoteControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submitVote(vote: 1 | -1) {
    startTransition(async () => {
      setMessage(null);

      const response = await fetch(`/api/ai/${trackId}/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vote }),
      });

      if (!response.ok) {
        setMessage("Vote failed. Try again.");
        return;
      }

      setMessage(vote === 1 ? "Upvote recorded." : "Downvote recorded.");
      router.refresh();
    });
  }

  return (
    <div className="interactiveStack">
      <div className="voteRow">
        <button type="button" onClick={() => submitVote(1)} disabled={isPending}>
          Upvote
        </button>
        <button type="button" onClick={() => submitVote(-1)} disabled={isPending}>
          Downvote
        </button>
      </div>

      {message ? <p className="mutationMessage">{message}</p> : null}
    </div>
  );
}