"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function CategoriesScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    // Reset both page and overlay scroll so categories always opens from the top.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    const overlay = document.querySelector<HTMLElement>(".favouritesBlindInner");
    if (overlay) {
      overlay.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [pathname]);

  return null;
}
