"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";

import {
  ARTISTS_LETTER_CHANGE_EVENT,
  dispatchArtistsLetterChange,
  isValidArtistLetter,
  normalizeArtistLetter,
  type ArtistsLetterChangeDetail,
} from "@/lib/artists-letter-events";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type ArtistsLetterNavProps = {
  activeLetter: string;
  v?: string;
  resume?: string;
  variant?: "panel" | "mobile";
};

function updateArtistsLetterInUrl(letter: string, v?: string, resume?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("letter", letter);

  if (v) {
    url.searchParams.set("v", v);
  } else {
    url.searchParams.delete("v");
  }

  if (resume) {
    url.searchParams.set("resume", resume);
  } else {
    url.searchParams.delete("resume");
  }

  window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}`);
}

export function ArtistsLetterNav({ activeLetter, v, resume, variant = "panel" }: ArtistsLetterNavProps) {
  const initialLetter = useMemo(() => {
    const normalized = normalizeArtistLetter(activeLetter);
    return isValidArtistLetter(normalized) ? normalized : "A";
  }, [activeLetter]);
  const [selectedLetter, setSelectedLetter] = useState(initialLetter);

  useEffect(() => {
    setSelectedLetter(initialLetter);
  }, [initialLetter]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<ArtistsLetterChangeDetail>;
      const nextLetter = custom.detail?.letter;
      if (nextLetter && isValidArtistLetter(nextLetter)) {
        setSelectedLetter(nextLetter);
      }
    };

    window.addEventListener(ARTISTS_LETTER_CHANGE_EVENT, handler);
    return () => {
      window.removeEventListener(ARTISTS_LETTER_CHANGE_EVENT, handler);
    };
  }, []);

  function onLetterClick(event: MouseEvent<HTMLAnchorElement>, letter: string) {
    event.preventDefault();
    const normalized = normalizeArtistLetter(letter);
    if (!isValidArtistLetter(normalized)) {
      return;
    }

    if (normalized === selectedLetter) {
      return;
    }

    setSelectedLetter(normalized);
    updateArtistsLetterInUrl(normalized, v, resume);
    dispatchArtistsLetterChange(normalized);
  }

  const wrapperClassName = variant === "mobile"
    ? "artistAlphabetBar artistAlphabetBarMobileOnly"
    : "artistsLetterPanel";
  const innerClassName = variant === "mobile"
    ? undefined
    : "artistsLetterPanelGrid";

  return (
    <nav className={wrapperClassName} aria-label="Filter artists by first letter">
      <div className={innerClassName}>
        {ALPHABET.map((letter) => {
          const params = new URLSearchParams();
          params.set("letter", letter);
          if (v) params.set("v", v);
          if (resume) params.set("resume", resume);

          const isActive = letter === selectedLetter;
          return (
            <Link
              key={letter}
              href={`/artists?${params.toString()}`}
              className={isActive ? "artistAlphabetButton artistAlphabetButtonActive" : "artistAlphabetButton"}
              onClick={(event) => onLetterClick(event, letter)}
            >
              {letter}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
