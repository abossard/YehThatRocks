import { AppShell } from "@/components/app-shell";
import { AuthRegisterForm } from "@/components/auth-register-form";
import { getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

export default async function RegisterPage() {
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo("v-Su1YXQYek"),
    getRelatedVideos("v-Su1YXQYek")
  ]);

  return (
    <AppShell
      activePath="/account"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Register"
      title="Create account"
      description="Registration now has its own route shell for email, screen name, password policy, and anti-bot controls."
    >
      <AuthRegisterForm />
    </AppShell>
  );
}
