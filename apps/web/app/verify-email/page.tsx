import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

type VerifyEmailPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const status = typeof resolvedSearchParams?.status === "string" ? resolvedSearchParams.status : "pending";
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo("SU1apJTv94o"),
    getRelatedVideos("SU1apJTv94o")
  ]);

  const message = status === "success"
    ? "Your email has been verified."
    : status === "invalid"
      ? "That verification link is invalid or expired."
      : "Check your email for the verification link.";

  return (
    <AppShell
      activePath="/account"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Verify email"
      title="Confirm your address"
      description="Email verification keeps account recovery and alerts secure."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Email verification</span>
          <strong>{status === "success" ? "Address confirmed" : "Verification status"}</strong>
        </div>
        <p className="authMessage">{message}</p>
        <div className="primaryActions compactActions">
          <Link href="/account" className="navLink navLinkActive">Account</Link>
          <Link href="/login" className="navLink">Login</Link>
        </div>
      </section>
    </AppShell>
  );
}
