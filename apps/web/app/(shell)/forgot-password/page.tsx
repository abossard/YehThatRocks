import { CloseLink } from "@/components/close-link";
import { AuthForgotPasswordForm } from "@/components/auth-forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Password reset</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Forgot password</span>
          <strong>Issue a one-time reset link</strong>
        </div>
        <AuthForgotPasswordForm />
      </section>
    </>
  );
}
