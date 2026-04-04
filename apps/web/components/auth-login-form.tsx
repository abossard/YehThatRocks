"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type BrowserPasswordCredential = {
  id: string;
  password: string;
};

type CredentialsContainerLike = {
  get?: (options?: { password?: boolean; mediation?: "optional" | "required" | "silent" }) => Promise<unknown>;
  store?: (credential: unknown) => Promise<unknown>;
};

function getBrowserCredentialsContainer() {
  return (navigator as Navigator & { credentials?: CredentialsContainerLike }).credentials;
}

export function AuthLoginForm() {
  const formRef = useRef<HTMLFormElement | null>(null);
  const hasAttemptedAutoLoginRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitLogin(email: string, password: string) {
    const remember = true;

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, remember }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Login failed. Please try again.");
        return false;
      }

      const credentials = getBrowserCredentialsContainer();

      if (formRef.current && typeof window !== "undefined" && "PasswordCredential" in window && credentials?.store) {
        try {
          const credential = new PasswordCredential(formRef.current);
          await credentials.store(credential);
        } catch {
          // Ignore browser credential storage failures; auth already succeeded.
        }
      }

      const videoParam = new URLSearchParams(window.location.search).get("v");
      window.location.assign(videoParam ? `/?v=${encodeURIComponent(videoParam)}` : "/");
      return true;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    await submitLogin(email, password);
  }

  useEffect(() => {
    if (hasAttemptedAutoLoginRef.current) {
      return;
    }

    hasAttemptedAutoLoginRef.current = true;

    const credentials = getBrowserCredentialsContainer();
    if (!credentials?.get) {
      return;
    }

    let cancelled = false;

    void credentials
      .get({
        password: true,
        mediation: "optional",
      })
      .then(async (credential) => {
        if (cancelled || isSubmitting || !credential || typeof credential !== "object") {
          return;
        }

        const candidate = credential as Partial<BrowserPasswordCredential>;
        const email = typeof candidate.id === "string" ? candidate.id.trim() : "";
        const password = typeof candidate.password === "string" ? candidate.password : "";

        if (!email || !password) {
          return;
        }

        if (formRef.current) {
          const emailInput = formRef.current.elements.namedItem("email") as HTMLInputElement | null;
          const passwordInput = formRef.current.elements.namedItem("password") as HTMLInputElement | null;

          if (emailInput) {
            emailInput.value = email;
          }

          if (passwordInput) {
            passwordInput.value = password;
          }
        }

        await submitLogin(email, password);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isSubmitting]);

  return (
    <form ref={formRef} className="authForm" onSubmit={handleSubmit}>
      <label>
        <span>Email</span>
        <input name="email" type="email" placeholder="you@example.com" required autoComplete="username" />
      </label>
      <label>
        <span>Password</span>
        <input
          name="password"
          type="password"
          placeholder="••••••••"
          required
          minLength={8}
          autoComplete="current-password"
        />
      </label>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Logging in..." : "Login"}
      </button>
      {error ? <p className="authMessage">{error}</p> : null}
    </form>
  );
}
