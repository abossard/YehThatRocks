import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { AuthLoginForm } from "@/components/auth-login-form";
import { getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

export default async function LoginPage() {
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo("3YxaaGgTQYM"),
    getRelatedVideos("3YxaaGgTQYM")
  ]);

  return (
    <AppShell
      activePath="/account"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Login"
      title="Session entry"
      description="Secure email/password auth is now active with HttpOnly token cookies and refresh-token session continuation."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Login form</span>
          <strong>Production auth baseline enabled</strong>
        </div>
        <AuthLoginForm />
        <div className="primaryActions compactActions">
          <Link href="/forgot-password" className="navLink">Forgot password?</Link>
        </div>
      </section>
    </AppShell>
  );
}
