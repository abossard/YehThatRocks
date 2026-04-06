import { notFound } from "next/navigation";
import Image from "next/image";

import { CloseLink } from "@/components/close-link";
import { UserProfilePanel } from "@/components/user-profile-panel";
import { getPublicUserProfile } from "@/lib/catalog-data";

type UserProfilePageProps = {
  params: Promise<{ screenName: string }>;
};

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { screenName } = await params;
  const { user, favourites, playlists } = await getPublicUserProfile(decodeURIComponent(screenName));

  if (!user) {
    notFound();
  }

  return (
    <>
      <div className="favouritesBlindBar userProfileBar">
        <div className="userProfileHeaderWrap">
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt=""
              width={56}
              height={56}
              className="userProfileHeaderAvatar"
            />
          ) : (
            <div className="userProfileHeaderAvatarFallback" aria-hidden="true">👤</div>
          )}
          <div className="userProfileHeaderContent">
            <strong>{user.screenName}</strong>
            {user.bio && <p className="userProfileHeaderBio">{user.bio}</p>}
            {user.location && (
              <p className="userProfileHeaderLocation">
                <span aria-hidden="true">📍</span> {user.location}
              </p>
            )}
          </div>
        </div>
        <CloseLink />
      </div>

      <UserProfilePanel user={user} favourites={favourites} playlists={playlists} />
    </>
  );
}
