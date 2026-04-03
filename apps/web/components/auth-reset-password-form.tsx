"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type AuthResetPasswordFormProps = {
  token: string;
};

export function AuthResetPasswordForm({ token }: AuthResetPasswordFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        setError("Reset token is invalid or expired.");
        return;
      }

      setMessage("Password updated. Redirecting to login...");
      window.setTimeout(() => {
        router.push("/login");
      }, 900);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="authForm" onSubmit={handleSubmit}>
      <label>
        <span>New password</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <label>
        <span>Confirm password</span>
        <input name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Reset password"}</button>
      {message ? <p className="authMessage">{message}</p> : null}
      {error ? <p className="authMessage">{error}</p> : null}
    </form>
  );
}
