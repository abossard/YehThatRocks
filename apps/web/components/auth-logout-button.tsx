"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthLogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });

      if (!response.ok) {
        setIsSubmitting(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setIsSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      className="favouritesBlindClose accountTopBarAction"
      onClick={handleLogout}
      disabled={isSubmitting}
    >
      {isSubmitting ? "Signing out..." : "Logout"}
    </button>
  );
}
