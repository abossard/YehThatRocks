import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { AdminDashboardPanel, type AdminTab } from "@/components/admin-dashboard-panel";
import { requireAdminUser } from "@/lib/admin-auth";

const ADMIN_TABS: AdminTab[] = ["overview", "categories", "videos", "artists"];

function resolveAdminTab(tab: string | null | undefined): AdminTab {
  if (tab && ADMIN_TABS.includes(tab as AdminTab)) {
    return tab as AdminTab;
  }

  return "overview";
}

export default async function AdminPage(props: {
  searchParams?: Promise<{ tab?: string | string[] | undefined }> | { tab?: string | string[] | undefined };
}) {
  const adminUser = await requireAdminUser();
  const searchParams = await Promise.resolve(props.searchParams ?? {});
  const rawTab = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab;
  const activeTab = resolveAdminTab(rawTab ?? undefined);
  const tabClass = (tab: AdminTab) => (activeTab === tab ? "navLink navLinkActive" : "navLink");

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whiteAccountGlyph" aria-hidden="true">🛠</span> Admin</strong>
        <div className="accountTopBarActions">
          <Link href="/admin?tab=overview" className={tabClass("overview")}>Overview</Link>
          <Link href="/admin?tab=categories" className={tabClass("categories")}>Categories</Link>
          <Link href="/admin?tab=videos" className={tabClass("videos")}>Videos</Link>
          <Link href="/admin?tab=artists" className={tabClass("artists")}>Artists</Link>
          <CloseLink />
        </div>
      </div>

      {adminUser ? (
        <AdminDashboardPanel activeTab={activeTab} />
      ) : (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span><span className="whiteAccountGlyph" aria-hidden="true">🛠</span> Session</span>
            <strong>Admin access required</strong>
          </div>
          <div className="interactiveStack">
            <p className="authMessage">This area is only available to the site administrator account.</p>
            <div className="primaryActions compactActions">
              <Link href="/login" className="navLink navLinkActive">Login</Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
