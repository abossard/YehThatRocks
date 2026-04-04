import { CloseLink } from "@/components/close-link";

export default function TopHundredLoading() {
  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Top 100</strong>
        <CloseLink />
      </div>

      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
        <span className="playerBootBars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>Loading top 100...</span>
      </div>
    </>
  );
}
