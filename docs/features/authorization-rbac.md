# Feature: Authorization & RBAC

## Context
The system implements role-based access control (RBAC) through user groups with many-to-many permission assignment, plus direct user-level permissions. Effective permissions are the union of group permissions and direct permissions. A zero-trust default means users with no groups and no direct permissions have zero access. The admin UI provides group management, user permission assignment, and admin impersonation for support workflows.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 154 | 29 permissions across 9 resources | Met |
| 162 | User groups with membership and permissions | Met |
| 163 | checkPermission middleware on all endpoints | Met |
| 164 | No implicit access — zero permissions by default | Met |
| 165 | Direct user permissions, union with group permissions | Met |
| 166 | Admin API for group CRUD and membership | Met |
| 167 | Admin API for user permission management | Met |
| 168 | Auth endpoints include permissions in response | Met |
| 169 | Frontend admin pages | Met |
| 166 | Conditional admin nav visibility | Met |

### Permission Model (Req #154)
- **Resources (9):** parts, inventory, equipment, tasks, projects, harness, requirements, admin, orders
- **Actions (3 base):** read, write, delete
- **Special actions (2):** requirements.approve, admin.impersonate
- **Total permissions:** 29 (9×3 + 2 special)

### Permission Enforcement (Req #163)
- `checkPermission(resource, action)` middleware on all route files
- Exempt routes: auth/*, config/*
- Resource mapping: inventory/* → inventory, order/orderitem → orders, parts/* → harness, planning/* → tasks/projects, design/* → requirements, admin/* → admin
- Action mapping: GET → read, POST/PUT → write, DELETE → delete
- 403 returned when permission not in effective set

### Admin Impersonation
- `POST /api/admin/user/:id/impersonate` → 1-hour JWT with `impersonatedBy` claim
- No refresh token issued for impersonation
- Frontend toolbar turns orange during impersonation
- Auto-stops on 401

## API Contracts

### Groups — `/api/admin/group/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/admin/group` | Yes | admin.read | List active groups |
| GET | `/api/admin/group/:id` | Yes | admin.read | Get group with members + permissions |
| POST | `/api/admin/group` | Yes | admin.write | Create group |
| PUT | `/api/admin/group/:id` | Yes | admin.write | Update group (name, description, permissionIds) |
| DELETE | `/api/admin/group/:id` | Yes | admin.delete | Soft delete group |
| POST | `/api/admin/group/:id/member` | Yes | admin.write | Add member `{userID}` |
| DELETE | `/api/admin/group/:id/member/:userId` | Yes | admin.delete | Remove member |

### Users — `/api/admin/user/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/admin/user` | Yes | admin.read | List all users |
| GET | `/api/admin/user/:id` | Yes | admin.read | Get user with groups + direct + effective permissions |
| PUT | `/api/admin/user/:id/permissions` | Yes | admin.write | Set direct permissions `{permissionIds: [...]}` |
| POST | `/api/admin/user/:id/impersonate` | Yes | admin.impersonate | Get 1-hour impersonation JWT |

### Permissions — `/api/admin/permission/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/admin/permission` | Yes | admin.read | List all permissions |

## UI Design

### Groups List (`/admin/groups`)
- Table: name, description, member count, actions
- Create button → group edit page
- Protected by `adminGuard` (requires `admin.read`)

### Group Edit (`/admin/groups/:id`, `/admin/groups/new`)
- **Name/description form**
- **Members table:** user list with add/remove
- **Permissions grid:** resources (rows) × actions (columns) checkboxes

### Users List (`/admin/users`)
- Table of all users with groups, status

### User Permissions (`/admin/users/:id`)
- User info header
- Group membership chips
- Direct permissions grid (resources × CRUD actions)
- Effective permissions display (union of group + direct)

### Permission-Gated UI Elements
- Buttons disabled with tooltip when lacking write permission
- Harness editor view-only mode when lacking `harness.write`
- Admin sidebar group shown only with `admin.read`
- "View Only" badge on harness editor

### Impersonation UI
- Toolbar turns orange during impersonation
- Shows impersonated user name
- "Stop Impersonating" button
- Original admin token saved to `original_auth_token` localStorage

## Database Changes

### Permissions Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| resource | STRING(50) | NOT NULL |
| action | STRING(50) | NOT NULL |
| description | TEXT | nullable |
| createdAt | DATE | NOT NULL |
| **Unique** | | (resource, action) |

### UserGroups Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(100) | NOT NULL, UNIQUE |
| description | TEXT | nullable |
| activeFlag | BOOLEAN | NOT NULL, default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### UserGroupMembers Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| userID | INTEGER | FK → Users, CASCADE |
| groupID | INTEGER | FK → UserGroups, CASCADE |
| createdAt | DATE | NOT NULL |
| **Unique** | | (userID, groupID) |

### GroupPermissions Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| groupID | INTEGER | FK → UserGroups, CASCADE |
| permissionID | INTEGER | FK → Permissions, CASCADE |
| createdAt | DATE | NOT NULL |
| **Unique** | | (groupID, permissionID) |

### UserPermissions Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| userID | INTEGER | FK → Users, CASCADE |
| permissionID | INTEGER | FK → Permissions, CASCADE |
| createdAt | DATE | NOT NULL |
| **Unique** | | (userID, permissionID) |

### Seed Data
- 29 permissions seeded via migration
- "Admin" group created with all 29 permissions
- "Default" group created with no permissions

### Relevant Migrations
- `20260216000000-create-permission-tables.js` — all 5 tables + seed data

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/admin/user-group.test.js` — group CRUD, member add/remove, permission assignment, soft delete
- `backend/tests/__tests__/admin/user-permission.test.js` — list permissions, list users, get user, set direct permissions
- `backend/tests/__tests__/admin/permission-enforcement.test.js` — direct permissions, group permissions, inactive groups, action-level enforcement, resource mapping
- `backend/tests/__tests__/admin/impersonation.test.js` — impersonation JWT, permission requirements

### Frontend (Karma)
- `frontend/src/app/components/admin/groups-list/groups-list.spec.ts`
- `frontend/src/app/components/admin/group-edit/group-edit.spec.ts`
- `frontend/src/app/components/admin/users-list/users-list.spec.ts`
- `frontend/src/app/components/admin/user-permissions/user-permissions.spec.ts`
- `frontend/src/app/components/admin/permission-grid/permission-grid.spec.ts`
- `frontend/src/app/components/admin/user-create-dialog/user-create-dialog.spec.ts`

### E2E (Playwright)
- `frontend/e2e/navigation.spec.ts` — admin nav visibility

## Implementation Notes

### Key Files
- `backend/middleware/checkPermission.js` — permission enforcement middleware
- `backend/middleware/loadEffectivePermissions.js` — loads union of group + direct permissions
- `backend/api/admin/group/controller.js` — group CRUD
- `backend/api/admin/user/controller.js` — user management, impersonation
- `backend/models/admin/` — Permission, UserGroup, UserGroupMember, GroupPermission, UserPermission models
- `frontend/src/app/components/admin/` — all admin UI components
- `frontend/src/app/guards/permission.guard.ts` — route-level permission guard
- `frontend/src/app/services/auth.service.ts` — `hasPermission()` signal

### Patterns Followed
- Zero-trust: no implicit access
- Effective permissions = union(group permissions, direct permissions)
- Permissions cached on `req._effectivePermissions` per request
- Auth endpoints return permissions array for frontend UI gating
- 403 in frontend interceptor does NOT clear token

### Edge Cases
- First admin must be bootstrapped via direct database insert into UserGroupMembers
- Inactive groups do not contribute permissions
- Impersonation JWT has no refresh — 1-hour hard expiry
- `admin.impersonate` is a special permission separate from admin CRUD
