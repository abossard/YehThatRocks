import { CloseLink } from "@/components/close-link";
import { AuthRegisterForm } from "@/components/auth-register-form";

export default function RegisterPage() {
  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Register</strong>
        <CloseLink />
      </div>
      <AuthRegisterForm />
    </>
  );
}
