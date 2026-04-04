import { CloseLink } from "@/components/close-link";

export default function ArtistsLoading() {
  return (
    <>
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb">🎸 Artists</span>
        </strong>
        <CloseLink />
      </div>

      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
        <span className="playerBootBars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>Loading artists...</span>
      </div>
    </>
  );
}
