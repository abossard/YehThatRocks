"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function AuthRegisterForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const screenName = String(formData.get("screenName") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const remember = true;

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, screenName, password, remember }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Registration failed. Please try again.");
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="authForm authFormWide" onSubmit={handleSubmit}>
      <label>
        <span>Email</span>
        <input name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
      </label>
      <label>
        <span>Screen name</span>
        <input name="screenName" type="text" placeholder="MetalFan204" required minLength={2} maxLength={40} />
      </label>
      <label>
        <span>Password</span>
        <input
          name="password"
          type="password"
          placeholder="Minimum 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>
      <label>
        <span>Confirm password</span>
        <input
          name="confirmPassword"
          type="password"
          placeholder="Repeat password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>
      <button type="submit" disabled={isSubmitting} className="spanTwoColumns">
        {isSubmitting ? "Registering..." : "Register"}
      </button>
      {error ? <p className="authMessage spanTwoColumns">{error}</p> : null}
    </form>
  );
}
