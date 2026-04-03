import { AppShell } from "@/components/app-shell";
import { AuthForgotPasswordForm } from "@/components/auth-forgot-password-form";
import { getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

export default async function ForgotPasswordPage() {
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo("3YxaaGgTQYM"),
    getRelatedVideos("3YxaaGgTQYM")
  ]);

  return (
    <AppShell
      activePath="/account"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Password reset"
      title="Recover access"
      description="Request a secure password reset link for your account."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Forgot password</span>
          <strong>Issue a one-time reset link</strong>
        </div>
        <AuthForgotPasswordForm />
      </section>
    </AppShell>
  );
}
