"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AuthAccountActionsProps = {
  emailVerified: boolean;
  showLogout?: boolean;
};

export function AuthAccountActions({ emailVerified, showLogout = true }: AuthAccountActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/auth/logout", { method: "POST" });

      if (!response.ok) {
        setMessage("Logout failed.");
        return;
      }

      router.push("/");
      router.refresh();
    });
  }

  function handleSendVerification() {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/auth/send-verification", { method: "POST" });

      if (!response.ok) {
        setMessage("Unable to send verification email.");
        return;
      }

      setMessage("Verification email sent.");
    });
  }

  return (
    <div className="interactiveStack">
      {!emailVerified ? (
        <div className="accountVerificationRow">
          <span className="accountVerificationLabel">Email not verified</span>
          <div className="accountVerificationActions">
            <p className="accountVerificationHint">Verify your email address to unlock all account features.</p>
            <button type="button" onClick={handleSendVerification} disabled={isPending}>
              {isPending ? "Sending..." : "Send verification email"}
            </button>
            {message ? <p className="authMessage">{message}</p> : null}
          </div>
        </div>
      ) : null}
      {showLogout ? (
        <div className="primaryActions compactActions">
          <button type="button" onClick={handleLogout} disabled={isPending}>
            {isPending ? "Signing out..." : "Logout"}
          </button>
          {message ? <p className="authMessage">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
