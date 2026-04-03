import { AppShell } from "@/components/app-shell";
import { AuthResetPasswordForm } from "@/components/auth-reset-password-form";
import { getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

type ResetPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const token = typeof resolvedSearchParams?.token === "string" ? resolvedSearchParams.token : "";
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo("v-Su1YXQYek"),
    getRelatedVideos("v-Su1YXQYek")
  ]);

  return (
    <AppShell
      activePath="/account"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Reset password"
      title="Choose a new password"
      description="Complete your one-time password reset securely."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Reset password</span>
          <strong>One-time secure password update</strong>
        </div>
        {token ? <AuthResetPasswordForm token={token} /> : <p className="authMessage">Missing reset token.</p>}
      </section>
    </AppShell>
  );
}
