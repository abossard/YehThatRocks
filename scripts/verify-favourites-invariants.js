#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  favouritesPage: path.join(ROOT, "apps/web/app/(shell)/favourites/page.tsx"),
  favouritesGrid: path.join(ROOT, "apps/web/components/favourites-grid.tsx"),
  favouritesRoute: path.join(ROOT, "apps/web/app/api/favourites/route.ts"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  globalCss: path.join(ROOT, "apps/web/app/globals.css"),
};

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function assertContains(source, needle, description, failures) {
  if (!source.includes(needle)) {
    failures.push(`${description} (missing: ${needle})`);
  }
}

function main() {
  const failures = [];

  const favouritesPageSource = read(files.favouritesPage);
  const favouritesGridSource = read(files.favouritesGrid);
  const favouritesRouteSource = read(files.favouritesRoute);
  const apiSchemasSource = read(files.apiSchemas);
  const globalCssSource = read(files.globalCss);

  // --- Favourites page: server-side auth and data loading ---
  assertContains(favouritesPageSource, "getCurrentAuthenticatedUser", "Favourites page resolves current authenticated user server-side", failures);
  assertContains(favouritesPageSource, "getFavouriteVideos(user.id)", "Favourites page loads favourites for authenticated user only", failures);
  assertContains(favouritesPageSource, "user ? await getFavouriteVideos(user.id) : []", "Favourites page returns empty array for unauthenticated visitors", failures);
  assertContains(favouritesPageSource, "<FavouritesGrid", "Favourites page renders FavouritesGrid component", failures);
  assertContains(favouritesPageSource, "isAuthenticated={hasAccessToken}", "Favourites page passes auth state to FavouritesGrid", failures);
  assertContains(favouritesPageSource, "initialFavourites={favourites}", "Favourites page passes server-loaded favourites to FavouritesGrid", failures);

  // --- FavouritesGrid: client-side refresh and event handling ---
  assertContains(favouritesGridSource, "ytr:favourites-updated", "FavouritesGrid listens for ytr:favourites-updated refresh event", failures);
  assertContains(favouritesGridSource, "window.addEventListener(\"ytr:favourites-updated\"", "FavouritesGrid subscribes to favourites updated event", failures);
  assertContains(favouritesGridSource, "window.removeEventListener(\"ytr:favourites-updated\"", "FavouritesGrid unsubscribes from favourites updated event on cleanup", failures);
  assertContains(favouritesGridSource, "pathname !== \"/favourites\"", "FavouritesGrid only refreshes when on the favourites page", failures);
  assertContains(favouritesGridSource, "cache: \"no-store\"", "FavouritesGrid refreshes with no-store to bypass cache", failures);

  // --- FavouritesGrid: optimistic removal ---
  assertContains(favouritesGridSource, "setFavourites((current) => current.filter((track) => track.id !== videoId))", "FavouritesGrid removes track from local state optimistically", failures);
  assertContains(favouritesGridSource, "action: \"remove\"", "FavouritesGrid sends remove action to favourites API", failures);

  // --- FavouritesGrid: auth-gated error handling ---
  assertContains(favouritesGridSource, "response.status === 401 || response.status === 403", "FavouritesGrid handles 401/403 from favourites API gracefully", failures);
  assertContains(favouritesGridSource, "Sign in to manage favourites", "FavouritesGrid shows sign-in prompt for unauthenticated actions", failures);

  // --- FavouritesGrid: accessibility ---
  assertContains(favouritesGridSource, "aria-label={`Remove ${track.title} from favourites`}", "FavouritesGrid remove button has descriptive aria-label", failures);
  assertContains(favouritesGridSource, "disabled={!isAuthenticated || isPending || isRemoving}", "FavouritesGrid remove button is disabled while mutations are in-flight", failures);

  // --- FavouritesGrid: empty state ---
  assertContains(favouritesGridSource, "favouritesEmptyState", "FavouritesGrid renders empty state container", failures);
  assertContains(favouritesGridSource, "role=\"status\"", "FavouritesGrid empty state has role=status for screen readers", failures);
  assertContains(favouritesGridSource, "aria-live=\"polite\"", "FavouritesGrid empty state uses aria-live=polite", failures);

  // --- Favourites API route: authentication ---
  assertContains(favouritesRouteSource, "requireApiAuth(request)", "Favourites GET route requires authenticated session", failures);
  assertContains(favouritesRouteSource, "export async function GET", "Favourites route exports GET handler", failures);
  assertContains(favouritesRouteSource, "export async function POST", "Favourites route exports POST handler for mutations", failures);

  // --- Favourites API route: CSRF and validation ---
  assertContains(favouritesRouteSource, "verifySameOrigin(request)", "Favourites POST route enforces same-origin CSRF check", failures);
  assertContains(favouritesRouteSource, "favouriteMutationSchema.safeParse(bodyResult.data)", "Favourites POST validates body against favouriteMutationSchema", failures);
  assertContains(favouritesRouteSource, "updateFavourite(parsed.data.videoId, parsed.data.action, authResult.auth.userId)", "Favourites POST delegates to updateFavourite with correct arguments", failures);

  // --- Schema: favouriteMutationSchema ---
  assertContains(apiSchemasSource, "export const favouriteMutationSchema", "api-schemas exports favouriteMutationSchema", failures);
  assertContains(apiSchemasSource, "action: z.enum([\"add\", \"remove\"])", "favouriteMutationSchema constrains action to add or remove", failures);
  assertContains(apiSchemasSource, "videoId: z.string().min(1)", "favouriteMutationSchema requires non-empty videoId", failures);

  // --- CSS: favourites layout classes ---
  assertContains(globalCssSource, ".favouritesBlindBar", "globals.css defines .favouritesBlindBar header style", failures);
  assertContains(globalCssSource, ".favouritesCatalogGrid", "globals.css defines .favouritesCatalogGrid layout", failures);
  assertContains(globalCssSource, ".favouritesDeleteButton", "globals.css defines .favouritesDeleteButton style", failures);
  assertContains(globalCssSource, ".favouritesEmptyState", "globals.css defines .favouritesEmptyState style", failures);

  if (failures.length > 0) {
    console.error("Favourites invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Favourites invariant check passed.");
}

main();
