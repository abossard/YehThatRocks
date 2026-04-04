"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function CloseLinkInner() {
  const searchParams = useSearchParams();
  const v = searchParams.get("v");
  return (
    <Link
      href={v ? `/?v=${encodeURIComponent(v)}&resume=1` : "/"}
      className="favouritesBlindClose"
    >
      Close
    </Link>
  );
}

export function CloseLink() {
  return (
    <Suspense fallback={<span className="favouritesBlindClose">Close</span>}>
      <CloseLinkInner />
    </Suspense>
  );
}
