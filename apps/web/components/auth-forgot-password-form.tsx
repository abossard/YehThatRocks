"use client";

import { FormEvent, useState } from "react";

export function AuthForgotPasswordForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        setError("Unable to process reset request.");
        return;
      }

      setMessage("If that email exists, a reset link has been sent.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="authForm" onSubmit={handleSubmit}>
      <label>
        <span>Email</span>
        <input name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
      </label>
      <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send reset link"}</button>
      {message ? <p className="authMessage">{message}</p> : null}
      {error ? <p className="authMessage">{error}</p> : null}
    </form>
  );
}
