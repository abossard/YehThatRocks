import { CloseLink } from "@/components/close-link";
import { FavouritesGrid } from "@/components/favourites-grid";
import { getFavouriteVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function FavouritesPage() {
  const user = await getCurrentAuthenticatedUser();
  const favourites = user ? await getFavouriteVideos(user.id) : [];

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whiteHeart" aria-hidden="true">❤️</span> Favourites</strong>
        <CloseLink />
      </div>

      <FavouritesGrid initialFavourites={favourites} isAuthenticated={Boolean(user)} />
    </>
  );
}
