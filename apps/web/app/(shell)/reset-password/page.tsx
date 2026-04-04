import { CloseLink } from "@/components/close-link";
import { AuthResetPasswordForm } from "@/components/auth-reset-password-form";

type ResetPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const token = typeof resolvedSearchParams?.token === "string" ? resolvedSearchParams.token : "";

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Reset password</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Reset password</span>
          <strong>One-time secure password update</strong>
        </div>
        {token ? <AuthResetPasswordForm token={token} /> : <p className="authMessage">Missing reset token.</p>}
      </section>
    </>
  );
}
