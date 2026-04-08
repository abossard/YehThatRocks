import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { CloseLink } from "@/components/close-link";
import { NewScrollReset } from "@/components/new-scroll-reset";
import { Top100VideoLink } from "@/components/top100-video-link";
import { getNewestVideos } from "@/lib/catalog-data";

export default async function NewPage() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const newestVideos = await getNewestVideos(20);

  return (
    <>
      <NewScrollReset />

      <div className="favouritesBlindBar">
        <strong><span style={{filter: "brightness(0) invert(1)"}}>⭐</span> New</strong>
        <CloseLink />
      </div>

      <div className="trackStack spanTwoColumns">
        {newestVideos.map((track, index) => (
          <Top100VideoLink key={track.id} track={track} index={index} isAuthenticated={isAuthenticated} />
        ))}
      </div>
    </>
  );
}