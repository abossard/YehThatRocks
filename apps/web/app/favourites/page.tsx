import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { FavouritesManager } from "@/components/favourites-manager";
import { getCurrentVideo, getFavouriteVideos, getRelatedVideos, getTopVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function FavouritesPage() {
  const user = await getCurrentAuthenticatedUser();
  const [currentVideo, relatedVideos, favourites, topVideos] = await Promise.all([
    getCurrentVideo("47e_961OQWE"),
    getRelatedVideos("47e_961OQWE"),
    getFavouriteVideos(user?.id),
    getTopVideos()
  ]);

  return (
    <AppShell
      activePath="/favourites"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Favourites"
      title="Saved videos panel"
      description="The favourites route is now present as a first-class page and keeps the player visible while the saved list updates around it."
    >
      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Saved list</span>
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
    </AppShell>
  );
}
