"use client";

import Link from "next/link";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type ArtistsLetterNavProps = {
  activeLetter: string;
  v?: string;
  resume?: string;
};

export function ArtistsLetterNav({ activeLetter, v, resume }: ArtistsLetterNavProps) {
  return (
    <nav className="artistsLetterPanel" aria-label="Filter artists by first letter">
      <div className="artistsLetterPanelGrid">
        {ALPHABET.map((letter) => {
          const params = new URLSearchParams();
          params.set("letter", letter);
          if (v) params.set("v", v);
          if (resume) params.set("resume", resume);

          const isActive = letter === activeLetter;
          return (
            <Link
              key={letter}
              href={`/artists?${params.toString()}`}
              className={isActive ? "artistAlphabetButton artistAlphabetButtonActive" : "artistAlphabetButton"}
            >
              {letter}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
