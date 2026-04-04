import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { FavouritesManager } from "@/components/favourites-manager";
import { getFavouriteVideos, getTopVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function FavouritesPage() {
  const user = await getCurrentAuthenticatedUser();
  const [favourites, topVideos] = await Promise.all([
    getFavouriteVideos(user?.id),
    getTopVideos(),
  ]);

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whiteHeart" aria-hidden="true">❤️</span> Favourites</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span><span className="whiteHeart" aria-hidden="true">❤️</span> Saved list</span>
          <strong>{user ? "Your saved favourites" : "Sign in to use favourites"}</strong>
        </div>
        <FavouritesManager favourites={favourites} candidates={topVideos} isAuthenticated={Boolean(user)} />
      </section>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Account note</span>
          <strong>Session auth now active</strong>
        </div>
        <div className="statusBlock inlineStatus">
          <p>
            Favourites and playlists APIs now require authenticated sessions with
            short-lived access tokens and long-lived refresh tokens.
          </p>
          <div className="routeContractRow">
            <Link href="/api/favourites" className="navLink">
              View JSON Endpoint
            </Link>
            <span className="contractHint">
              POST to <code>/api/favourites</code> with <code>{'{"videoId":"...","action":"add"}'}</code>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
