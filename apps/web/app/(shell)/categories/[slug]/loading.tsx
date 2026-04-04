import { CloseLink } from "@/components/close-link";

export default function CategoryDetailLoading() {
  return (
    <>
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
            <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
            <span>Categories</span>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">Loading...</span>
          </span>
        </strong>
        <CloseLink />
      </div>

      <div className="categoryVideoGrid" aria-busy="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <article key={index} className="categoryVideoCard">
            <div className="categoryThumbWrap" />
            <h3 className="categoryVideoTitle">Loading category...</h3>
          </article>
        ))}
      </div>
    </>
  );
}
