import Link from "next/link";

import { CloseLink } from "@/components/close-link";

type VerifyEmailPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const status = typeof resolvedSearchParams?.status === "string" ? resolvedSearchParams.status : "pending";

  const message =
    status === "success"
      ? "Your email has been verified."
      : status === "invalid"
        ? "That verification link is invalid or expired."
        : "Check your email for the verification link.";

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Verify email</strong>
        <CloseLink />
      </div>

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
    </>
  );
}
