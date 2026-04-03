"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AuthAccountActionsProps = {
  emailVerified: boolean;
};

export function AuthAccountActions({ emailVerified }: AuthAccountActionsProps) {
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
      <div className="primaryActions compactActions">
        {!emailVerified ? (
          <button type="button" onClick={handleSendVerification} disabled={isPending}>
            {isPending ? "Sending..." : "Send verification email"}
          </button>
        ) : null}
        <button type="button" onClick={handleLogout} disabled={isPending}>
          {isPending ? "Signing out..." : "Logout"}
        </button>
      </div>
      {message ? <p className="authMessage">{message}</p> : null}
    </div>
  );
}
