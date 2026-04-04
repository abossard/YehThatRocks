import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { AuthAccountActions } from "@/components/auth-account-actions";
import { AuthChangePasswordForm } from "@/components/auth-change-password-form";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function AccountPage() {
  const user = await getCurrentAuthenticatedUser();

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whiteAccountGlyph" aria-hidden="true">👤</span> Account</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span><span className="whiteAccountGlyph" aria-hidden="true">👤</span> Session</span>
          <strong>{user ? "Authenticated account" : "Login required"}</strong>
        </div>
        {user ? (
          <div className="catalogGrid compactGrid">
            <article className="catalogCard">
              <p className="statusLabel">Email</p>
              <h3>{user.email ?? "No email"}</h3>
              <p>{user.emailVerifiedAt ? "Verified" : "Verification pending"}</p>
            </article>
            <article className="catalogCard">
              <p className="statusLabel">Screen name</p>
              <h3>{user.screenName ?? "Unset"}</h3>
              <p>Profile naming is now session-backed.</p>
            </article>
            <article className="catalogCard">
              <p className="statusLabel">Password</p>
              <h3>Password reset</h3>
              <p>Use the reset flow to rotate credentials securely.</p>
            </article>
          </div>
        ) : (
          <div className="interactiveStack">
            <p className="authMessage">You are not currently signed in.</p>
            <div className="primaryActions compactActions">
              <Link href="/login" className="navLink navLinkActive">Login</Link>
              <Link href="/register" className="navLink">Register</Link>
            </div>
          </div>
        )}
      </section>

      {user ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Account actions</span>
            <strong>Verification and session controls</strong>
          </div>
          <AuthAccountActions emailVerified={Boolean(user.emailVerifiedAt)} />
        </section>
      ) : null}

      {user ? (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span>Password</span>
            <strong>Change password in-session</strong>
          </div>
          <AuthChangePasswordForm />
        </section>
      ) : null}
    </>
  );
}
