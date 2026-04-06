"use client";

import { useEffect } from "react";

type ShareRedirectProps = {
  targetHref: string;
};

export function ShareRedirect({ targetHref }: ShareRedirectProps) {
  useEffect(() => {
    window.location.replace(targetHref);
  }, [targetHref]);

  return null;
}
