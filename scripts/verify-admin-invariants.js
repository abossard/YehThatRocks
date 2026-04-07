#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  adminAuth: path.join(ROOT, "apps/web/lib/admin-auth.ts"),
  accountPage: path.join(ROOT, "apps/web/app/(shell)/account/page.tsx"),
  adminPage: path.join(ROOT, "apps/web/app/(shell)/admin/page.tsx"),
  adminDashboardRoute: path.join(ROOT, "apps/web/app/api/admin/dashboard/route.ts"),
  adminCategoriesRoute: path.join(ROOT, "apps/web/app/api/admin/categories/route.ts"),
  adminVideosRoute: path.join(ROOT, "apps/web/app/api/admin/videos/route.ts"),
  adminArtistsRoute: path.join(ROOT, "apps/web/app/api/admin/artists/route.ts"),
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

  const adminAuthSource = read(files.adminAuth);
  const accountPageSource = read(files.accountPage);
  const adminPageSource = read(files.adminPage);
  const adminDashboardRouteSource = read(files.adminDashboardRoute);
  const adminCategoriesRouteSource = read(files.adminCategoriesRoute);
  const adminVideosRouteSource = read(files.adminVideosRoute);
  const adminArtistsRouteSource = read(files.adminArtistsRoute);

  // Admin identity and auth guard invariants.
  assertContains(adminAuthSource, 'const ADMIN_EMAIL = "simonjamesodell@live.co.uk";', "Admin auth pins the owner email", failures);
  assertContains(adminAuthSource, "const ENFORCE_ADMIN_USER_ID = process.env.NODE_ENV === \"production\";", "Admin auth enforces user-id lock in production", failures);
  assertContains(adminAuthSource, "export function isAdminIdentity", "Admin auth exposes shared identity helper", failures);
  assertContains(adminAuthSource, "export async function requireAdminApiAuth", "Admin API routes are guardable with requireAdminApiAuth", failures);
  assertContains(adminAuthSource, 'response: NextResponse.json({ error: "Forbidden" }, { status: 403 })', "Admin API guard returns 403 for non-admin users", failures);
  assertContains(adminAuthSource, "export async function requireAdminUser()", "Admin page can enforce server-side admin user checks", failures);

  // Account page entry-point invariants.
  assertContains(accountPageSource, 'import { isAdminIdentity } from "@/lib/admin-auth";', "Account page reuses centralized admin identity logic", failures);
  assertContains(accountPageSource, "const isAdminUser = Boolean(user?.email && isAdminIdentity(user.id, user.email));", "Account page computes admin visibility from shared helper", failures);
  assertContains(accountPageSource, '<Link href="/admin" className="favouritesBlindClose">Admin Panel</Link>', "Account top bar renders admin button for admin user", failures);
  assertContains(accountPageSource, "className=\"accountTopBarActions\"", "Account page keeps grouped top bar actions", failures);

  // Admin page and API security invariants.
  assertContains(adminPageSource, "const adminUser = await requireAdminUser();", "Admin page enforces server-side admin session checks", failures);
  assertContains(adminPageSource, "<AdminDashboardPanel activeTab={activeTab} />", "Admin page renders dashboard for authorized user", failures);
  assertContains(adminPageSource, "Admin access required", "Admin page shows explicit denial state for unauthorized users", failures);

  assertContains(adminDashboardRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin dashboard API requires admin auth", failures);
  assertContains(adminCategoriesRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin categories API requires admin auth", failures);
  assertContains(adminVideosRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin videos API requires admin auth", failures);
  assertContains(adminArtistsRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin artists API requires admin auth", failures);

  // Mutating endpoints must keep CSRF protection.
  assertContains(adminCategoriesRouteSource, "const csrf = verifySameOrigin(request);", "Admin categories PATCH enforces CSRF", failures);
  assertContains(adminVideosRouteSource, "const csrf = verifySameOrigin(request);", "Admin videos PATCH enforces CSRF", failures);
  assertContains(adminArtistsRouteSource, "const csrf = verifySameOrigin(request);", "Admin artists PATCH enforces CSRF", failures);

  // Admin artists route must remain schema-drift resilient.
  assertContains(adminVideosRouteSource, "SHOW COLUMNS FROM videos", "Admin videos API introspects live table columns", failures);
  assertContains(adminVideosRouteSource, "channelTitle: pickColumn(available, [\"channelTitle\", \"channel_title\"])", "Admin videos API supports channel title column drift", failures);
  assertContains(adminVideosRouteSource, "const orderCol = columns.updatedAt ? columns.updatedAt : columns.id;", "Admin videos API supports ordering fallback when updatedAt column differs", failures);
  assertContains(adminArtistsRouteSource, "SHOW COLUMNS FROM artists", "Admin artists API introspects live table columns", failures);
  assertContains(adminArtistsRouteSource, "const name = pickColumn(available, [\"artist\", \"name\"]);", "Admin artists API supports artist/name column drift", failures);

  if (failures.length > 0) {
    console.error("Admin invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Admin invariant check passed.");
}

main();
