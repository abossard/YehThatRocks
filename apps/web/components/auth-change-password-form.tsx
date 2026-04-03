"use client";

import { FormEvent, useState } from "react";

export function AuthChangePasswordForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to change password.");
        return;
      }

      setMessage("Password updated. Other sessions have been signed out.");
      event.currentTarget.reset();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="authForm" onSubmit={handleSubmit}>
      <label>
        <span>Current password</span>
        <input name="currentPassword" type="password" required minLength={8} autoComplete="current-password" />
      </label>
      <label>
        <span>New password</span>
        <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <label>
        <span>Confirm new password</span>
        <input name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Change password"}</button>
      {message ? <p className="authMessage">{message}</p> : null}
      {error ? <p className="authMessage">{error}</p> : null}
    </form>
  );
}
