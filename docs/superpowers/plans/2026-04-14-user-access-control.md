# Per-User Sidebar Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an admin to control, per user, which sidebar pages of the trading dashboard that user can see and access. Non-admin users see nothing by default; admin ticks pages in a side-drawer UI. ADMIN role bypasses the permission list.

**Architecture:** Backend stores `allowedPages: List<String>` on the `User` document. A new `SidebarPage` enum is the canonical page catalogue. Admin REST endpoints read/write permissions and return the canonical list. Frontend filters sidebar nav items and guards protected routes by `requiredPage`. Admin UI adds a drawer with checkboxes.

**Tech Stack:** Spring Boot + MongoDB (backend), React + Vite + TypeScript + React Router (frontend).

**Spec:** `docs/superpowers/specs/2026-04-14-user-access-control-design.md`

---

## File Structure

### Backend (new or modified)
- `model/entity/User.java` — **modify**: add `allowedPages`
- `security/SidebarPage.java` — **create**: enum of page keys + labels
- `service/UserProfileService.java` — **modify**: add `updateAllowedPages`, `getAllowedPages`, block self-demotion
- `controller/AdminController.java` — **modify**: 3 new endpoints (`GET /sidebar-pages`, `GET/PUT /users/{id}/permissions`)
- `controller/AuthController.java` — **modify**: ensure registration sets `role=TRADER` + empty `allowedPages`
- `service/AuthService.java` — **modify**: same (where `register()` lives)
- `model/dto/auth/UserResponse.java` — **modify**: add `allowedPages` field

### Frontend (new or modified)
- `services/api.ts` — **modify**: add `adminApi.getSidebarPages/getUserPermissions/updateUserPermissions`; extend `UserProfile` with `allowedPages`
- `context/AuthContext.tsx` — **modify**: consume `allowedPages` from `/me`
- `components/Layout/Sidebar.tsx` — **modify**: add `key` per nav item; filter by `allowedPages`
- `components/Layout/MobileTabBar.tsx` — **modify**: same filter
- `components/ProtectedRoute.tsx` — **modify**: add `requiredPage` prop
- `App.tsx` — **modify**: wire `requiredPage` on every protected route
- `pages/AdminPage.tsx` — **modify**: add "Permissions" button
- `components/Admin/UserPermissionsDrawer.tsx` — **create**
- `pages/NoAccessPage.tsx` — **create**

---

## Task 1: Backend — SidebarPage enum

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/security/SidebarPage.java`

- [ ] **Step 1: Create the enum**

```java
package com.kotsin.dashboard.security;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

public enum SidebarPage {
    DASHBOARD("dashboard", "Dashboard"),
    WATCHLIST("watchlist", "Watchlist"),
    ORDERS("orders", "Orders"),
    POSITIONS("positions", "Positions"),
    TRADES("trades", "Trades"),
    PNL("pnl", "PnL Analytics"),
    SIGNALS("signals", "Signals"),
    RISK("risk", "Risk"),
    QUANT_SCORES("quant-scores", "Quant Score"),
    GREEK_TRAILING("greek-trailing", "Greek Trail"),
    PERFORMANCE("performance", "Performance"),
    PATTERNS("patterns", "Patterns"),
    INSIGHTS("insights", "Insights"),
    MARKET_PULSE("market-pulse", "Market Pulse"),
    HOT_STOCKS("hot-stocks", "HotStocks"),
    STRATEGY("strategy", "Strategy"),
    WALLETS("wallets", "Wallets"),
    ML_SHADOW("ml-shadow", "ML Shadow");

    private final String key;
    private final String label;

    SidebarPage(String key, String label) {
        this.key = key;
        this.label = label;
    }

    public String getKey() { return key; }
    public String getLabel() { return label; }

    public static Set<String> allKeys() {
        return Arrays.stream(values()).map(SidebarPage::getKey).collect(Collectors.toSet());
    }

    public static List<SidebarPage> asList() {
        return Arrays.asList(values());
    }

    public static boolean isValid(String key) {
        return allKeys().contains(key);
    }
}
```

- [ ] **Step 2: Compile check**

Run: `cd /home/ubuntu/trading-dashboard/backend && mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard
git add backend/src/main/java/com/kotsin/dashboard/security/SidebarPage.java
git commit -m "feat(auth): add SidebarPage enum as canonical page catalogue"
```

---

## Task 2: Backend — User entity + UserResponse field

**Files:**
- Modify: `backend/src/main/java/com/kotsin/dashboard/model/entity/User.java`
- Modify: `backend/src/main/java/com/kotsin/dashboard/model/dto/auth/UserResponse.java`

- [ ] **Step 1: Add `allowedPages` to `User.java`**

Insert after the `enabled` field (line ~37):

```java
    @Builder.Default
    private java.util.List<String> allowedPages = new java.util.ArrayList<>();
```

- [ ] **Step 2: Add `allowedPages` to `UserResponse.java`**

Add field:
```java
    private java.util.List<String> allowedPages;
```

In `fromUser()` builder chain, add:
```java
                .allowedPages(user.getAllowedPages() != null ? user.getAllowedPages() : java.util.List.of())
```

- [ ] **Step 3: Compile**

Run: `cd /home/ubuntu/trading-dashboard/backend && mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/kotsin/dashboard/model/entity/User.java backend/src/main/java/com/kotsin/dashboard/model/dto/auth/UserResponse.java
git commit -m "feat(auth): add allowedPages to User entity and UserResponse DTO"
```

---

## Task 3: Backend — Signup defaults + UserProfileService additions

**Files:**
- Modify: `backend/src/main/java/com/kotsin/dashboard/service/UserProfileService.java`
- Modify: `backend/src/main/java/com/kotsin/dashboard/service/AuthService.java` (or wherever `register()` builds the `User`)

- [ ] **Step 1: Locate register()**

Run: `grep -n "new User\\|User.builder()" /home/ubuntu/trading-dashboard/backend/src/main/java/com/kotsin/dashboard/service/AuthService.java`
Read the file and find the builder that constructs a new `User` for registration.

- [ ] **Step 2: Force `role="TRADER"` and empty `allowedPages` in register()**

In the `User.builder()` chain inside `register()`:
- Replace any role parameter with literal `"TRADER"`.
- Add `.allowedPages(new java.util.ArrayList<>())`.

Example (adapt to actual code):
```java
User user = User.builder()
    .username(request.getUsername())
    .email(request.getEmail())
    .passwordHash(passwordEncoder.encode(request.getPassword()))
    .displayName(request.getDisplayName())
    .role("TRADER")
    .allowedPages(new java.util.ArrayList<>())
    .enabled(true)
    .build();
```

- [ ] **Step 3: Add permission methods to `UserProfileService`**

Append to `UserProfileService.java`:

```java
    public UserResponse updateAllowedPages(String userId, java.util.List<String> pages) {
        java.util.Set<String> valid = com.kotsin.dashboard.security.SidebarPage.allKeys();
        for (String p : pages) {
            if (!valid.contains(p)) {
                throw new IllegalArgumentException("Unknown page key: " + p);
            }
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setAllowedPages(new java.util.ArrayList<>(pages));
        user.setUpdatedAt(java.time.LocalDateTime.now());
        userRepository.save(user);
        log.info("Updated allowedPages for user {} to {}", user.getUsername(), pages);
        return UserResponse.fromUser(user);
    }

    public java.util.List<String> getAllowedPages(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        return user.getAllowedPages() != null ? user.getAllowedPages() : java.util.List.of();
    }
```

- [ ] **Step 4: Block self-demotion in `updateUserRole`**

Modify existing `updateUserRole` to accept a caller id and guard. Change signature:
```java
    public UserResponse updateUserRole(String userId, String role, String callerUserId) {
        if (userId.equals(callerUserId) && !"ADMIN".equals(role)) {
            throw new IllegalArgumentException("Cannot change your own admin role");
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setRole(role);
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        log.info("Updated role for user {} to {}", user.getUsername(), role);
        return UserResponse.fromUser(user);
    }
```

- [ ] **Step 5: Compile**

Run: `cd /home/ubuntu/trading-dashboard/backend && mvn -q compile`
Expected: BUILD SUCCESS (will fail if `AdminController` still calls old 2-arg signature — Task 4 fixes the caller).

If compile fails because of `updateUserRole` call site, proceed directly to Task 4 before compiling again.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): signup hardcodes TRADER role; add permission service methods; block self-demotion"
```

---

## Task 4: Backend — AdminController endpoints

**Files:**
- Modify: `backend/src/main/java/com/kotsin/dashboard/controller/AdminController.java`

- [ ] **Step 1: Inject principal + add endpoints**

Replace the file with (keeping slippage endpoint intact):

```java
package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.auth.UserResponse;
import com.kotsin.dashboard.model.entity.User;
import com.kotsin.dashboard.security.SidebarPage;
import com.kotsin.dashboard.service.SlippageBackfillService;
import com.kotsin.dashboard.service.UserProfileService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {

    private final UserProfileService profileService;
    private final SlippageBackfillService slippageBackfillService;

    public AdminController(UserProfileService profileService, SlippageBackfillService slippageBackfillService) {
        this.profileService = profileService;
        this.slippageBackfillService = slippageBackfillService;
    }

    @GetMapping("/users")
    public ResponseEntity<?> getUsers(@RequestParam(defaultValue = "0") int page,
                                       @RequestParam(defaultValue = "20") int size) {
        Page<User> users = profileService.getAllUsers(
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return ResponseEntity.ok(Map.of(
                "content", users.getContent().stream().map(UserResponse::fromUser).toList(),
                "totalElements", users.getTotalElements(),
                "totalPages", users.getTotalPages()
        ));
    }

    @PutMapping("/users/{userId}/role")
    public ResponseEntity<?> updateRole(@PathVariable String userId,
                                         @RequestBody Map<String, String> body,
                                         @AuthenticationPrincipal UserDetails caller) {
        try {
            String callerId = profileService.getProfile(resolveUserIdFromUsername(caller.getUsername())).getId();
            return ResponseEntity.ok(profileService.updateUserRole(userId, body.get("role"), callerId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/users/{userId}/enable")
    public ResponseEntity<?> toggleEnabled(@PathVariable String userId, @RequestBody Map<String, Boolean> body) {
        try {
            return ResponseEntity.ok(profileService.toggleUserEnabled(userId, body.getOrDefault("enabled", true)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/users/{userId}")
    public ResponseEntity<?> deleteUser(@PathVariable String userId) {
        try {
            profileService.deleteUser(userId);
            return ResponseEntity.ok(Map.of("message", "User deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/sidebar-pages")
    public ResponseEntity<?> getSidebarPages() {
        List<Map<String, String>> list = Arrays.stream(SidebarPage.values())
                .map(p -> Map.of("key", p.getKey(), "label", p.getLabel()))
                .toList();
        return ResponseEntity.ok(list);
    }

    @GetMapping("/users/{userId}/permissions")
    public ResponseEntity<?> getPermissions(@PathVariable String userId) {
        try {
            return ResponseEntity.ok(Map.of("allowedPages", profileService.getAllowedPages(userId)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/users/{userId}/permissions")
    public ResponseEntity<?> updatePermissions(@PathVariable String userId,
                                                @RequestBody Map<String, List<String>> body) {
        try {
            List<String> pages = body.getOrDefault("allowedPages", List.of());
            return ResponseEntity.ok(profileService.updateAllowedPages(userId, pages));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/backfill-slippage")
    public ResponseEntity<?> backfillSlippage() {
        try {
            int count = slippageBackfillService.backfillAll();
            return ResponseEntity.ok(Map.of(
                    "message", "Slippage backfill complete",
                    "tradesUpdated", count
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    private String resolveUserIdFromUsername(String username) {
        // UserProfileService currently lacks a findByUsername lookup. Simpler: fetch through repository.
        return profileService.findIdByUsername(username);
    }
}
```

- [ ] **Step 2: Add `findIdByUsername` to `UserProfileService`**

Append:
```java
    public String findIdByUsername(String username) {
        return userRepository.findByUsername(username)
                .map(User::getId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + username));
    }
```

Check that `UserRepository` already has `findByUsername` (it almost certainly does — used by AuthService). If missing:

```java
    java.util.Optional<User> findByUsername(String username);
```
in `UserRepository.java`.

- [ ] **Step 3: Simplify role endpoint (avoid double lookup)**

Replace the `updateRole` handler body above with a direct principal lookup — cleaner:
```java
    @PutMapping("/users/{userId}/role")
    public ResponseEntity<?> updateRole(@PathVariable String userId,
                                         @RequestBody Map<String, String> body,
                                         @AuthenticationPrincipal UserDetails caller) {
        try {
            String callerId = profileService.findIdByUsername(caller.getUsername());
            return ResponseEntity.ok(profileService.updateUserRole(userId, body.get("role"), callerId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
```
Remove the now-unused `resolveUserIdFromUsername` helper.

- [ ] **Step 4: Compile**

Run: `cd /home/ubuntu/trading-dashboard/backend && mvn -q compile`
Expected: BUILD SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): admin endpoints for sidebar-pages and per-user permissions"
```

---

## Task 5: Backend — manual verification

- [ ] **Step 1: Restart backend**

```bash
cd /home/ubuntu/trading-dashboard/backend
ps aux | grep "spring-boot:run" | grep -v grep | awk '{print $2}' | xargs -r kill -9
nohup mvn spring-boot:run > nohup.out 2>&1 &
sleep 30 && tail -50 nohup.out
```
Expected: Application started on port 8085, no stack traces.

- [ ] **Step 2: Log in as admin and hit endpoints**

Replace `<TOKEN>` with a real admin JWT (use browser devtools → localStorage `kotsin_auth_token` after logging in as an existing ADMIN user).

```bash
TOKEN=<paste-admin-token>
curl -s http://localhost:8085/api/admin/sidebar-pages -H "Authorization: Bearer $TOKEN" | head -c 500
```
Expected: JSON array of 18 `{key,label}` objects.

```bash
# Pick a non-admin user id from GET /api/admin/users
USER_ID=<some-trader-user-id>
curl -s http://localhost:8085/api/admin/users/$USER_ID/permissions -H "Authorization: Bearer $TOKEN"
```
Expected: `{"allowedPages":[]}`

```bash
curl -s -X PUT http://localhost:8085/api/admin/users/$USER_ID/permissions \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"allowedPages":["dashboard","watchlist"]}'
```
Expected: 200 with updated `UserResponse` including `"allowedPages":["dashboard","watchlist"]`.

```bash
curl -s -X PUT http://localhost:8085/api/admin/users/$USER_ID/permissions \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"allowedPages":["nonsense"]}'
```
Expected: 400 `{"error":"Unknown page key: nonsense"}`.

- [ ] **Step 3: Verify `/api/users/me` (or equivalent) returns allowedPages**

```bash
curl -s http://localhost:8085/api/users/me -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep allowedPages
```
Expected: `"allowedPages": [...]` present in response.

If the existing `/me` endpoint uses `UserResponse.fromUser` it will include the new field automatically. If it returns a different shape, find the endpoint (`grep -rn "/me" backend/src/main/java/com/kotsin/dashboard/controller`) and add `allowedPages` to its response.

- [ ] **Step 4: Commit any hotfix from Step 3**

```bash
git add -A && git diff --cached --quiet || git commit -m "fix(auth): include allowedPages in /me response"
```

---

## Task 6: Frontend — API client + types

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Extend `UserProfile` type**

Locate `export interface UserProfile` in `api.ts` and add:
```ts
  allowedPages?: string[];
```

- [ ] **Step 2: Add admin API functions**

Locate `adminApi` (existing object with `getUsers/updateUserRole/toggleUserEnabled/deleteUser`) and add:

```ts
  async getSidebarPages(): Promise<Array<{ key: string; label: string }>> {
    return fetchWithAuth('/api/admin/sidebar-pages').then(r => r.json());
  },
  async getUserPermissions(userId: string): Promise<{ allowedPages: string[] }> {
    return fetchWithAuth(`/api/admin/users/${userId}/permissions`).then(r => r.json());
  },
  async updateUserPermissions(userId: string, allowedPages: string[]): Promise<UserProfile> {
    return fetchWithAuth(`/api/admin/users/${userId}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedPages }),
    }).then(r => r.json());
  },
```

(Adapt the `fetchWithAuth` pattern to whatever existing `adminApi` functions use.)

- [ ] **Step 3: Build check**

Run: `cd /home/ubuntu/trading-dashboard/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(ui): api client for sidebar-pages and user permissions"
```

---

## Task 7: Frontend — NoAccessPage + ProtectedRoute + App routes

**Files:**
- Create: `frontend/src/pages/NoAccessPage.tsx`
- Modify: `frontend/src/components/ProtectedRoute.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create NoAccessPage**

```tsx
export default function NoAccessPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-8 max-w-lg text-center">
        <h1 className="text-2xl font-bold text-amber-400 mb-3">Access Pending</h1>
        <p className="text-slate-400">
          Your account has no pages enabled yet. Please contact your administrator to request access.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Read existing ProtectedRoute**

Run: `cat frontend/src/components/ProtectedRoute.tsx`
Note the current shape (props, redirect target).

- [ ] **Step 3: Modify ProtectedRoute**

Keep existing auth check. Add prop:

```tsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: JSX.Element;
  requiredPage?: string;
}

export default function ProtectedRoute({ children, requiredPage }: Props) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;

  if (requiredPage && user.role !== 'ADMIN') {
    const allowed = user.allowedPages ?? [];
    if (!allowed.includes(requiredPage)) {
      return <Navigate to="/no-access" replace />;
    }
  }
  return children;
}
```

(Preserve any other logic already in the file — merge rather than overwrite if there's additional behavior like redirect-to-login memory.)

- [ ] **Step 4: Wire `requiredPage` on routes in `App.tsx`**

Add import:
```tsx
import NoAccessPage from './pages/NoAccessPage';
```

Add route:
```tsx
<Route path="/no-access" element={<ProtectedRoute><Layout><NoAccessPage /></Layout></ProtectedRoute>} />
```

For every existing protected route, add `requiredPage="<key>"` matching the sidebar key. Mapping (route path → page key):

```
/dashboard       → dashboard
/watchlist       → watchlist
/orders          → orders
/positions       → positions
/trades          → trades
/pnl             → pnl
/signals         → signals
/risk            → risk
/quant-scores    → quant-scores
/greek-trailing  → greek-trailing
/performance     → performance
/patterns        → patterns
/insights        → insights
/market-pulse    → market-pulse
/hot-stocks      → hot-stocks
/strategy        → strategy
/wallets         → wallets
/ml-shadow       → ml-shadow
```

Also map these existing variant routes (per `App.tsx`):
- `/command-center` → `insights`
- `/market-intelligence` → `insights`
- `/stock/:scripCode` → no `requiredPage` (follow-up from `hot-stocks` / `quant-scores`)
- `/research/:symbol` → `hot-stocks`
- `/live` → `dashboard`
- `/profile` → no `requiredPage` (settings is always accessible)
- `/admin` → no `requiredPage` (already gated by role)

Example change for one route:

```tsx
<Route path="/wallets" element={
  <ProtectedRoute requiredPage="wallets">
    <Layout><StrategyWalletsPage /></Layout>
  </ProtectedRoute>
} />
```

Apply this edit to each route above.

- [ ] **Step 5: Build check**

Run: `cd /home/ubuntu/trading-dashboard/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): gate protected routes by allowedPages; add NoAccess page"
```

---

## Task 8: Frontend — Sidebar + MobileTabBar filtering

**Files:**
- Modify: `frontend/src/components/Layout/Sidebar.tsx`
- Modify: `frontend/src/components/Layout/MobileTabBar.tsx`

- [ ] **Step 1: Add `key` to each nav item in Sidebar.tsx**

In the `navItems: NavItem[]` declaration, update `NavItem` interface and each item:

```tsx
interface NavItem {
  path: string;
  key: string;
  label: string;
  icon: JSX.Element;
  requireAdmin?: boolean;
}
```

Add `key: '<page-key>'` to every entry, matching the path → key map in Task 7 Step 4. Example:
```tsx
{ path: '/dashboard', key: 'dashboard', label: 'Dashboard', icon: (...) },
{ path: '/watchlist', key: 'watchlist', label: 'Watchlist', icon: (...) },
{ path: '/wallets',   key: 'wallets',   label: 'Wallets',   icon: (...) },
// ...all 18 items
```

- [ ] **Step 2: Filter navItems before rendering**

Just before `return (`:
```tsx
const allowedPages = user?.allowedPages ?? [];
const isAdmin = user?.role === 'ADMIN';
const visibleNavItems = isAdmin ? navItems : navItems.filter(i => allowedPages.includes(i.key));
```

Replace `{navItems.map(item => (` with `{visibleNavItems.map(item => (`.

`bottomItems` (Settings + Admin) are left as-is.

- [ ] **Step 3: Apply the same filter to MobileTabBar.tsx**

Read the file, identify its nav item list, add `key` to each item matching the same table, and filter by `user.allowedPages` unless `user.role === 'ADMIN'`. Use `useAuth()` if not already imported.

- [ ] **Step 4: Build check**

Run: `cd /home/ubuntu/trading-dashboard/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): filter sidebar + mobile tab bar by allowedPages"
```

---

## Task 9: Frontend — UserPermissionsDrawer

**Files:**
- Create: `frontend/src/components/Admin/UserPermissionsDrawer.tsx`

- [ ] **Step 1: Create the drawer component**

```tsx
import { useEffect, useState } from 'react';
import { adminApi, type UserProfile } from '../../services/api';

interface Props {
  user: UserProfile | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function UserPermissionsDrawer({ user, onClose, onSaved }: Props) {
  const [pages, setPages] = useState<Array<{ key: string; label: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    Promise.all([adminApi.getSidebarPages(), adminApi.getUserPermissions(user.id)])
      .then(([list, perms]) => {
        setPages(list);
        setSelected(new Set(perms.allowedPages || []));
      })
      .catch(() => setError('Failed to load permissions'))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(pages.map(p => p.key)));
  const clearAll = () => setSelected(new Set());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.updateUserPermissions(user.id, Array.from(selected));
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Page Permissions</h2>
            <p className="text-xs text-slate-400">{user.displayName || user.username}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        {isAdmin && (
          <div className="mx-6 mt-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
            Admins have access to all pages. Editing is disabled.
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : (
            <>
              <div className="flex gap-2 mb-3">
                <button disabled={isAdmin} onClick={selectAll}
                  className="px-3 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 disabled:opacity-40">
                  Select all
                </button>
                <button disabled={isAdmin} onClick={clearAll}
                  className="px-3 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 disabled:opacity-40">
                  Clear all
                </button>
              </div>
              {pages.map(p => (
                <label key={p.key} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-800/50 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isAdmin}
                    checked={selected.has(p.key)}
                    onChange={() => toggle(p.key)}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="text-white text-sm">{p.label}</span>
                  <span className="text-slate-500 text-xs ml-auto">{p.key}</span>
                </label>
              ))}
            </>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <footer className="px-6 py-4 border-t border-slate-700 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600">
            Cancel
          </button>
          <button onClick={save} disabled={saving || isAdmin}
            className="px-4 py-2 bg-amber-500 text-slate-900 font-medium rounded hover:bg-amber-400 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `cd /home/ubuntu/trading-dashboard/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Admin/UserPermissionsDrawer.tsx
git commit -m "feat(ui): UserPermissionsDrawer component"
```

---

## Task 10: Frontend — Wire drawer into AdminPage

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Add state + button**

Add imports at top:
```tsx
import UserPermissionsDrawer from '../components/Admin/UserPermissionsDrawer';
```

Inside the component, add state:
```tsx
const [permissionsUser, setPermissionsUser] = useState<UserProfile | null>(null);
```

In the actions `<td>` (currently renders Delete only), insert BEFORE the Delete button:
```tsx
<button
  onClick={() => setPermissionsUser(u)}
  className="text-amber-400 hover:text-amber-300 text-sm transition-colors mr-3"
>
  Permissions
</button>
```

At the bottom of the component's JSX (before the closing `</div>` of the outermost wrapper), add:
```tsx
<UserPermissionsDrawer
  user={permissionsUser}
  onClose={() => setPermissionsUser(null)}
  onSaved={() => { loadUsers(); showMessage('success', 'Permissions updated'); }}
/>
```

- [ ] **Step 2: Build check**

Run: `cd /home/ubuntu/trading-dashboard/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(ui): add Permissions button + drawer on AdminPage"
```

---

## Task 11: End-to-end verification

- [ ] **Step 1: Restart frontend**

```bash
cd /home/ubuntu/trading-dashboard/frontend
ps aux | grep "npm run dev" | grep -v grep | awk '{print $2}' | xargs -r kill -9
nohup npm run dev > nohup.out 2>&1 &
sleep 8 && tail -30 nohup.out
```
Expected: Vite dev server running on :3001, no build errors.

- [ ] **Step 2: Manual test — admin flow**

1. Log in as an ADMIN user.
2. Sidebar still shows all items. Navigate to `/admin`.
3. Click "Permissions" on a TRADER row. Drawer opens, checkboxes all unchecked (empty list for fresh user).
4. Tick "Dashboard" and "Watchlist". Save. Toast confirms.
5. Reopen drawer for same user — boxes remain checked.

- [ ] **Step 3: Manual test — trader flow**

1. Log out. Log in as the TRADER user you just modified.
2. Sidebar shows ONLY Dashboard and Watchlist (plus bottom Settings).
3. Navigate directly to `/wallets` via URL. Expected: redirected to `/no-access` with "Access Pending" message.
4. Navigate to `/dashboard` and `/watchlist`. Expected: both render normally.

- [ ] **Step 4: Manual test — signup creates empty-access user**

1. Log out. Sign up a new user via `/signup`.
2. After signup, sidebar shows only Settings (no data pages).
3. Direct URL to `/dashboard` → redirects to `/no-access`.

- [ ] **Step 5: Manual test — admin bypass**

1. Log in as admin again. Open AdminPage. Open Permissions drawer for an ADMIN user.
2. Expected: banner "Admins have access to all pages. Editing is disabled." Save button disabled. Checkboxes disabled.

- [ ] **Step 6: Manual test — self-demotion guard**

1. As admin, attempt `PUT /api/admin/users/<your-own-id>/role` with body `{"role":"TRADER"}` via curl.
2. Expected: 400 `{"error":"Cannot change your own admin role"}`.

- [ ] **Step 7: Commit any small fixes**

```bash
git add -A && git diff --cached --quiet || git commit -m "fix(auth): e2e verification fixes"
```

---

## Spec Coverage Self-Check

| Spec item | Task |
|---|---|
| `User.allowedPages` field | 2 |
| `SidebarPage` enum | 1 |
| `GET /api/admin/sidebar-pages` | 4 |
| `GET /api/admin/users/{id}/permissions` | 4 |
| `PUT /api/admin/users/{id}/permissions` with enum validation | 3, 4 |
| `/me` includes `allowedPages` | 2 (via `UserResponse`) + 5 (verify) |
| Signup hardcodes TRADER + empty allowedPages | 3 |
| Self-demotion guard | 3, 4 |
| `UserProfile.allowedPages` on frontend | 6 |
| AuthContext populates allowedPages | (implicit — `authApi.me()` already returns it via `UserResponse`; no code change needed beyond Task 6's type extension) |
| Sidebar filters by allowedPages | 8 |
| MobileTabBar filters | 8 |
| `ProtectedRoute.requiredPage` | 7 |
| Every protected route wired | 7 |
| `/no-access` page | 7 |
| AdminPage "Permissions" button | 10 |
| `UserPermissionsDrawer` with Select all / Clear all | 9 |
| Admin bypass in UI | 8 (sidebar), 7 (route), 9 (drawer disables) |
| E2E verification | 11 |

No gaps identified.
