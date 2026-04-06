import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { AccountSettingsPanel } from "@/components/account-settings-panel";
import { AuthLogoutButton } from "@/components/auth-logout-button";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function AccountPage() {
  const user = await getCurrentAuthenticatedUser();

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whiteAccountGlyph" aria-hidden="true">👤</span> Account</strong>
        <div className="accountTopBarActions">
          {user ? <AuthLogoutButton /> : null}
          <CloseLink />
        </div>
      </div>

      {user ? (
        <AccountSettingsPanel
          user={{
            id: user.id,
            email: user.email,
            emailVerifiedAt: user.emailVerifiedAt,
            screenName: user.screenName,
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            location: user.location,
          }}
        />
      ) : (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span><span className="whiteAccountGlyph" aria-hidden="true">👤</span> Session</span>
            <strong>Login required</strong>
          </div>
          <div className="interactiveStack">
            <p className="authMessage">You are not currently signed in.</p>
            <div className="primaryActions compactActions">
              <Link href="/login" className="navLink navLinkActive">Login</Link>
              <Link href="/register" className="navLink">Register</Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
