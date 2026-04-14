# Per-User Sidebar Access Control — Design

**Date:** 2026-04-14
**Status:** Approved, pending implementation plan

## Goal
Allow an admin to control, per user, which sidebar pages of the trading dashboard that user can see and access. Admin ticks/unticks items from the canonical sidebar list per user.

## Decisions (from brainstorm)
1. **Granularity:** Per-page only. One permission per sidebar item. If unticked: page is hidden from sidebar AND direct URL access is blocked (redirect).
2. **Defaults:** New users see nothing. Admin must explicitly tick pages.
3. **Admin bypass:** `role == ADMIN` sees every page; permission list is ignored for admins.
4. **Admin creation:** Signup never creates ADMIN. ADMIN role can only be assigned via direct DB insert/update. Existing admin UI role dropdown kept but UI prevents self-demotion (if not already enforced).
5. **Source of truth:** Backend enum defines canonical page list. Admin UI fetches the list from backend. Backend validates keys on write.
6. **Enforcement depth:** Frontend-only (hide from sidebar + redirect on URL). Backend APIs remain open to any authenticated user. (Follow-up item: backend API-level enforcement, out of scope here.)
7. **Admin UX:** Side drawer per user row, opened from a "Permissions" button in the existing admin table.

## Data Model

### `User.java` (existing entity, add field)
```java
@Builder.Default
private List<String> allowedPages = new ArrayList<>();
```
- Stored in MongoDB `users` collection.
- Stores SidebarPage key strings (e.g., `["dashboard","watchlist","wallets"]`).
- Ignored when `role.equals("ADMIN")`.

### `SidebarPage.java` (new enum, backend source of truth)
Canonical list mirroring current `Sidebar.tsx`:
```
DASHBOARD("dashboard","Dashboard")
WATCHLIST("watchlist","Watchlist")
ORDERS("orders","Orders")
POSITIONS("positions","Positions")
TRADES("trades","Trades")
PNL("pnl","PnL Analytics")
SIGNALS("signals","Signals")
RISK("risk","Risk")
QUANT_SCORES("quant-scores","Quant Score")
GREEK_TRAILING("greek-trailing","Greek Trail")
PERFORMANCE("performance","Performance")
PATTERNS("patterns","Patterns")
INSIGHTS("insights","Insights")
MARKET_PULSE("market-pulse","Market Pulse")
HOT_STOCKS("hot-stocks","HotStocks")
STRATEGY("strategy","Strategy")
WALLETS("wallets","Wallets")
ML_SHADOW("ml-shadow","ML Shadow")
```
Key convention: matches the URL path (lowercased, hyphenated).

## Backend API

### New endpoints in `AdminController`
- `GET /api/admin/sidebar-pages` → `[{ "key": "dashboard", "label": "Dashboard" }, ...]`
  - Returns canonical list derived from `SidebarPage` enum.
- `GET /api/admin/users/{id}/permissions` → `{ "allowedPages": ["dashboard", ...] }`
- `PUT /api/admin/users/{id}/permissions` body `{ "allowedPages": ["dashboard", ...] }`
  - Validates every key against `SidebarPage`. Unknown keys → `400 Bad Request`.
  - Persists to `User.allowedPages`.
  - Requires caller role = ADMIN.

### New endpoint used by any authenticated user
- `GET /api/auth/my-pages` → `["dashboard", "watchlist", ...]`
  - Returns full set of all enum keys if caller is ADMIN.
  - Returns caller's `allowedPages` otherwise.

### Modified signup
- `AuthController.register()`: hardcode `role = "TRADER"` (confirm current behavior) and `allowedPages = []` on new `User` document.
- Admin role creation: documented as manual DB operation only.

### Self-demotion guard
- `PUT /api/admin/users/{id}/role`: if `id == currentUser.id` and new role != ADMIN → reject with `400`. (Check whether already enforced; add if not.)

## Frontend

### Types (`services/api.ts`)
```ts
interface UserProfile {
  ...existing fields...
  allowedPages?: string[];
}

interface SidebarPageDef { key: string; label: string; }
```

### `AuthContext.tsx`
- Extend `UserProfile` consumption: after login / `authApi.me()` / `authApi.refresh()`, also call `authApi.myPages()` and attach the result to `user.allowedPages` (unless already included in `/me` response — simpler: extend `/me` to include `allowedPages`).
- **Implementation choice:** extend the existing `UserProfileController` `/me` response with `allowedPages` — one less round-trip. `/api/auth/my-pages` retained for potential future polling / page-level refresh.

### `Sidebar.tsx`
- Each `NavItem` gets a new field `key: string` matching a SidebarPage key.
- Before rendering: if `user.role !== 'ADMIN'`, filter `navItems` by `user.allowedPages?.includes(item.key)`.
- `bottomItems` (`Settings`, `Admin`) are NOT gated by page permissions — Settings is always visible to a logged-in user; Admin remains gated by `role === 'ADMIN'`.

### `MobileTabBar.tsx`
- Same filter logic applied to its nav items.

### `ProtectedRoute.tsx`
- Add optional prop `requiredPage?: string`.
- After auth check: if `user.role !== 'ADMIN'` and `requiredPage` set and `!user.allowedPages?.includes(requiredPage)` → redirect to `/dashboard` if dashboard is allowed, else to `/no-access`.

### New route `/no-access`
- Minimal page: "Access pending — contact your administrator." Always reachable by authenticated user.

### `App.tsx`
- Each protected route declares its `requiredPage`, e.g.:
```tsx
<Route path="/wallets" element={<ProtectedRoute requiredPage="wallets"><StrategyWalletsPage/></ProtectedRoute>}/>
```

### `AdminPage.tsx`
- Add "Permissions" button in the actions column per row.
- Clicking opens `UserPermissionsDrawer` for that user.

### New component `UserPermissionsDrawer.tsx`
- Right-side drawer (slides in from the right), overlay dims the page.
- On open: fetches `GET /api/admin/sidebar-pages` (cached) and `GET /api/admin/users/{id}/permissions`.
- Renders checkbox list, each row = one SidebarPage.
- Buttons: "Select all", "Clear all", "Cancel", "Save".
- Save → `PUT /api/admin/users/{id}/permissions`, success toast, closes drawer.
- Disabled / hidden "Save" when user is ADMIN, with a note: "Admins have access to all pages."

## Edge Cases
- **Empty allowedPages + non-admin user:** every ProtectedRoute bounces to `/no-access`. Dashboard link from logo also redirects. User can still log out from TopBar.
- **Admin locks self out:** impossible — admins bypass permission check.
- **Admin demotes self:** blocked by backend self-demotion guard.
- **Enum expanded but frontend route not yet added:** admin can tick the key; no harm, just unused until frontend ships. Reverse is prevented because backend validates keys.
- **Key removed from enum while present in a user's document:** stale keys are silently ignored by the frontend filter. Optional cleanup: when loading `GET /permissions`, backend filters to currently-known keys.

## Files Touched
### Backend (new or modified)
- `model/entity/User.java` — add `allowedPages` field
- `security/SidebarPage.java` — new enum
- `controller/AdminController.java` — 3 new endpoints + self-demotion guard
- `controller/AuthController.java` — ensure signup sets role+allowedPages
- `controller/UserProfileController.java` — extend `/me` response with `allowedPages`
- `model/dto/auth/*` — DTO updates (`UserProfileDto` adds `allowedPages`)
- Optional: `model/dto/admin/UserPermissionsRequest.java` (new)

### Frontend (new or modified)
- `context/AuthContext.tsx` — populate `allowedPages` on user
- `services/api.ts` — `adminApi.getSidebarPages`, `getUserPermissions`, `updateUserPermissions`; `UserProfile.allowedPages`
- `components/Layout/Sidebar.tsx` — filter by allowedPages
- `components/Layout/MobileTabBar.tsx` — same filter
- `components/ProtectedRoute.tsx` — add `requiredPage` prop
- `App.tsx` — wire `requiredPage` on each protected route
- `pages/AdminPage.tsx` — add "Permissions" button
- `components/Admin/UserPermissionsDrawer.tsx` — new
- `pages/NoAccessPage.tsx` — new

## Out of Scope (explicitly)
- Backend API-level permission enforcement (noted as a follow-up).
- Sub-section or read/write granularity.
- Permission templates / role-based defaults.
- Audit log of permission changes.
