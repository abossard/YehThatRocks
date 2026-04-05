export const ARTISTS_LETTER_CHANGE_EVENT = "ytr:artists-letter-change";

export type ArtistsLetterChangeDetail = {
  letter: string;
};

export function isValidArtistLetter(letter: string) {
  return /^[A-Z]$/.test(letter);
}

export function normalizeArtistLetter(letter: string) {
  return letter.trim().toUpperCase();
}

export function dispatchArtistsLetterChange(letter: string) {
  const normalized = normalizeArtistLetter(letter);
  if (!isValidArtistLetter(normalized)) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ArtistsLetterChangeDetail>(ARTISTS_LETTER_CHANGE_EVENT, {
      detail: { letter: normalized },
    }),
  );
}
