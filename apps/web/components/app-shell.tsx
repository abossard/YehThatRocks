import Link from "next/link";
import Image from "next/image";
import { Suspense, type ReactNode } from "react";

import { AuthLoginForm } from "@/components/auth-login-form";
import { PlayerExperience } from "@/components/player-experience";
import { getDataSourceStatus } from "@/lib/catalog-data";
import { chatMessages, navItems, type VideoRecord } from "@/lib/catalog";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

type AppShellProps = {
  activePath: string;
  currentVideo: VideoRecord;
  relatedVideos: VideoRecord[];
  kicker: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
};

export async function AppShell({
  activePath,
  currentVideo,
  relatedVideos,
  kicker,
  title,
  description,
  children
}: AppShellProps) {
  const [dataSourceStatus, currentUser] = await Promise.all([
    getDataSourceStatus(),
    getCurrentAuthenticatedUser(),
  ]);
  const isOverlayRoute = activePath !== "/";
  const disableOverlayDropAnimation = activePath === "/categories" || activePath.startsWith("/categories/");
  const uniqueRelatedVideos = relatedVideos.filter(
    (video, index, allVideos) =>
      video.id !== currentVideo.id && allVideos.findIndex((candidate) => candidate.id === video.id) === index,
  );
  const visibleNavItems = (currentUser
    ? navItems
    : navItems.filter((item) => !["/favourites", "/playlists", "/account"].includes(item.href))).filter(
      (item) => item.href !== "/",
    );

  function getRelatedThumbnail(videoId: string) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
  }

  function getNavHref(href: string) {
    const params = new URLSearchParams({ v: currentVideo.id, resume: "1" });
    return `${href}?${params.toString()}`;
  }

  return (
    <main className={isOverlayRoute ? "shell shellOverlayRoute" : "shell"}>
      <div className="backdrop" />

      <header className="topbar">
        <div className="brandLockup">
          <Link href="/" aria-label="Yeh That Rocks home">
            <Image
              src="/assets/images/yeh4.png"
              alt="Yeh That Rocks"
              width={306}
              height={102}
              priority
              className="brandLogo"
            />
          </Link>
          <h1 className="brandTagline">The world&apos;s loudest website</h1>
        </div>

        <div className="headerBar">
          <nav className="mainNav" aria-label="Primary">
            {visibleNavItems.map((item) => {
              const isActive = activePath === item.href;

              return (
                <Link
                  key={item.href}
                  href={getNavHref(item.href)}
                  className={isActive ? "navLink navLinkActive" : "navLink"}
                >
                  {item.href === "/categories" ? (
                    <>
                      <span className="navCategoryGlyph" aria-hidden="true">☣</span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/artists" ? (
                    <>
                      <span className="navArtistsGlyph" aria-hidden="true">🎸︎</span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/top100" ? (
                    <>
                      <span className="navTop100Glyph" aria-hidden="true">🏆︎</span>
                      <span>{item.label}</span>
                    </>
                  ) : item.label}
                </Link>
              );
            })}
          </nav>

          <div className="searchWrap">
            <form action="/search">
              <input type="hidden" name="v" value={currentVideo.id} />
              <label className="searchLabel srOnly" htmlFor="search">
                Search artists, tracks, and chaos
              </label>
              <div className="searchBar">
                <input
                  id="search"
                  name="q"
                  type="search"
                  placeholder="Search rock, metal, artists, playlists..."
                />
                <button type="submit">Search</button>
              </div>
            </form>
          </div>
        </div>
      </header>

      <section className={isOverlayRoute ? "heroGrid heroGridOverlayRoute" : "heroGrid"}>
        <aside className={isOverlayRoute ? "leftRail panel translucent railOccluded" : "leftRail panel translucent"}>
          {currentUser ? (
            <>
              <div className="railTabs">
                <button type="button" className="activeTab">
                  Global Chat
                </button>
                <button type="button">Video Chat</button>
                <button type="button">Who&apos;s Online</button>
              </div>

              <div className="chatList">
                {chatMessages.map((message) => (
                  <article key={`${message.user}-${message.room}`} className="chatMessage">
                    <div className="avatar">{message.user.slice(0, 1)}</div>
                    <div>
                      <div className="messageMeta">
                        <strong>{message.user}</strong>
                        <span>{message.room}</span>
                      </div>
                      <p>{message.text}</p>
                    </div>
                  </article>
                ))}
              </div>

              <div className="chatComposer">
                <input type="text" placeholder="Say something loud..." />
                <button type="button">Send</button>
              </div>
            </>
          ) : (
            <div className="guestRail">
              <div className="panelHeading guestRailHeading">
                <span>Members only</span>
                <strong>Sign in to join chat, save favourites, and build playlists</strong>
              </div>

              <AuthLoginForm />

              <div className="guestRailActions">
                <Link href="/register" className="navLink">Create account</Link>
                <Link href="/forgot-password" className="navLink">Forgot password?</Link>
              </div>
            </div>
          )}
        </aside>

        <section className="playerStage">
          <div className="playerChrome">
            <Suspense fallback={<div className="playerLoadingFallback" />}>
              <PlayerExperience currentVideo={currentVideo} queue={[currentVideo, ...uniqueRelatedVideos]} isLoggedIn={!!currentUser} />
            </Suspense>

            {isOverlayRoute ? (
              <section
                className={disableOverlayDropAnimation ? "favouritesBlind favouritesBlindNoDrop" : "favouritesBlind"}
                aria-label="Favourites blind overlay"
              >
                <div className="favouritesBlindInner">
                  <div className="favouritesBlindBar">
                    <strong>{kicker}</strong>
                    <Link href={`/?v=${currentVideo.id}&resume=1`} className="favouritesBlindClose">
                      Close
                    </Link>
                  </div>
                  {children}
                </div>
              </section>
            ) : null}
          </div>
        </section>

        <aside className={isOverlayRoute ? "rightRail panel translucent railOccluded" : "rightRail panel translucent"}>
          <h2 className="railHeading">Related</h2>

          <div className="relatedStack">
            {uniqueRelatedVideos.map((track) => (
              <Link key={track.id} href={`/?v=${track.id}`} className="relatedCard linkedCard">
                <div className="thumbGlow">
                  <Image
                    src={getRelatedThumbnail(track.id)}
                    alt={track.title}
                    width={128}
                    height={72}
                    loading="lazy"
                    className="relatedThumb"
                  />
                </div>
                <div>
                  <h3>{track.title}</h3>
                  <p>{track.channelTitle}</p>
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
