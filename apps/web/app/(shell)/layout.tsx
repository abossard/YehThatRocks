import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { ShellDynamic } from "@/components/shell-dynamic";
import { getRelatedVideos as getSeedRelatedVideos, videos as seedVideos } from "@/lib/catalog";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const initialVideo = seedVideos[0];
  const initialRelatedVideos = getSeedRelatedVideos(initialVideo.id);
  const cookieStore = await cookies();
  const hasAccessToken = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);

  return (
    <ShellDynamic
      initialVideo={initialVideo}
      initialRelatedVideos={initialRelatedVideos}
      isLoggedIn={hasAccessToken}
    >
      {children}
    </ShellDynamic>
  );
}
