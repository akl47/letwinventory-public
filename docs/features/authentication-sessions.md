# Feature: Authentication & Sessions

## Context
The system authenticates users via Google OAuth 2.0, issues JWT access tokens, and manages sessions through httpOnly refresh token cookies. Multi-session support allows up to 10 concurrent sessions per user with device tracking. API keys provide programmatic access with scoped permissions and optional expiration. The settings page serves as the central hub for session management, API key configuration, and notification preferences.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 3 | Google OAuth 2.0 authentication | Met |
| 4 | JWT access tokens | Met |
| 5 | JWT token refresh via httpOnly cookie | Met |
| 6 | Protected API endpoints | Met |
| 7 | User profile view/update | Met |
| 8 | Google Add-on token exchange | Met |
| 9 | Frontend auth guard | Met |
| 10 | Auto-retry on 401 with token refresh | Met |
| 148 | User identity and attribution | Met |
| 151 | Data integrity (ALCOA) | Met |
| 155 | Multi-session support (max 10) | Met |
| 156 | Session management API | Met |
| 157 | API key CRUD | Met |
| 158 | API key scoped permissions | Met |
| 159 | API key token exchange | Met |
| 160 | API key expiration | Met |
| 161 | Settings page redesign | Met |

### OAuth Login Flow (Req #3)
- Google OAuth with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- Passport.js GoogleStrategy
- `GET /api/auth/google` redirects to Google consent screen
- `GET /api/auth/google/callback` processes OAuth token, creates/updates user, issues JWT + refresh token

### JWT Token Management (Req #4, Req #5)
- Access token: JWT signed with `JWT_SECRET`, payload `{ id, displayName, email }`, sent in `Authorization: Bearer <token>` header
- Refresh token: 64-char random string stored in `RefreshTokens` table, sent as httpOnly cookie
- `POST /api/auth/user/refresh` exchanges refresh token for new access token
- Frontend `authInterceptor` catches 401, refreshes token, queues and retries failed requests

### Multi-Session Support
- Up to 10 concurrent sessions per user
- Oldest session deactivated when limit exceeded
- `userAgent` stored on RefreshToken for device identification
- `session_id` cookie set on login for "This device" identification

### API Keys
- Scoped permissions at creation (immutable after)
- Optional `expiresAt` for key expiration
- `POST /api/auth/api-key/exchangeToken` returns JWT with intersection of key + user permissions
- Expired keys rejected at exchange time

## API Contracts

### Authentication — `/api/auth/google/*`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/google` | No | Redirect to Google OAuth consent |
| GET | `/api/auth/google/callback` | No | Process OAuth callback, issue tokens |
| POST | `/api/auth/google/test-login` | No | Test-only login with email (dev/test) |

### User — `/api/auth/user/*`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/user/checkToken` | Yes | Validate token, return user + permissions |
| GET | `/api/auth/user` | Yes | Get current user profile |
| PUT | `/api/auth/user` | Yes | Update user profile |
| POST | `/api/auth/user/refresh` | Cookie | Exchange refresh token for new access token |
| GET | `/api/auth/user/sessions` | Yes | List active sessions for current user |
| DELETE | `/api/auth/user/sessions/:id` | Yes | Revoke a specific session |

### API Keys — `/api/auth/api-key/*`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/api-key` | Yes | List current user's API keys |
| POST | `/api/auth/api-key` | Yes | Create API key with name, expiration, permissions |
| DELETE | `/api/auth/api-key/:id` | Yes | Revoke (soft delete) an API key |
| POST | `/api/auth/api-key/exchangeToken` | API Key | Exchange API key for JWT access token |

### Google Add-on — `/api/auth/addon/*`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/addon/token` | Google ID | Exchange Google ID token for Letwinventory JWT |

## UI Design

### Login Page (`/home`)
- Google "Sign in with Google" button
- `guestGuard` redirects authenticated users to `/tasks`

### Settings Page (`/settings`)
- **Route:** `/settings` (authGuard only, no permissionGuard)
- **Layout:** Full-width, accordion panels
- **Sections:**
  - **Profile:** Display name, email, photo
  - **Sessions:** Table of active sessions with device, last active, "This device" badge, revoke button
  - **API Keys:** Table with name, created date, last used, expires, status (active/expired), create/revoke. Create dialog: name, expiration date picker, permission grid (resources × actions checkboxes)
  - **Notifications:** Push notification toggle, device list, test notification button

### Auth Guard & Interceptor
- `authGuard`: checks `AuthService.isAuthenticated()` signal, redirects to `/home` if not authenticated
- `authInterceptor`: adds `Authorization` header, catches 401 → refresh + retry, 403 → propagate without clearing token

## Database Changes

### Users Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| googleID | STRING(100) | NOT NULL, UNIQUE |
| displayName | STRING(100) | NOT NULL, UNIQUE |
| email | STRING(100) | NOT NULL, UNIQUE, email validation |
| photoURL | TEXT | nullable |
| activeFlag | BOOLEAN | NOT NULL, default false |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### RefreshTokens Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| token | STRING(64) | NOT NULL, UNIQUE |
| userID | INTEGER | FK → Users, CASCADE |
| userAgent | STRING(255) | nullable |
| activeFlag | BOOLEAN | NOT NULL, default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### ApiKeys Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| keyHash | STRING(64) | NOT NULL, UNIQUE |
| name | STRING(100) | NOT NULL |
| userID | INTEGER | FK → Users, CASCADE |
| expiresAt | DATE | nullable |
| lastUsedAt | DATE | nullable |
| activeFlag | BOOLEAN | NOT NULL, default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### ApiKeyPermissions Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| apiKeyID | INTEGER | FK → ApiKeys, CASCADE |
| permissionID | INTEGER | FK → Permissions, CASCADE |
| createdAt | DATE | NOT NULL |
| **Unique** | | (apiKeyID, permissionID) |

### Relevant Migrations
- `20260112000000-initial.js` — Users, RefreshTokens
- `20260216000001-create-api-keys.js` — ApiKeys, ApiKeyPermissions
- `20260224000000-add-user-agent-to-refresh-tokens.js` — userAgent column

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/auth.test.js` — checkToken, refresh, getUser, updateUser
- `backend/tests/__tests__/auth/api-key.test.js` — API key CRUD, token exchange, scoped permissions, expiration

### Frontend (Karma)
- `frontend/src/app/guards/auth.guard.spec.ts` — allow when authenticated, redirect on failure
- `frontend/src/app/interceptors/auth.interceptor.spec.ts` — auth header, 401 refresh retry, 403 propagation, request queuing
- `frontend/src/app/services/auth.service.spec.ts` — service tests
- `frontend/src/app/components/settings/settings-page/settings-page.spec.ts` — sessions, API keys, notifications
- `frontend/src/app/components/settings/api-key-create-dialog/api-key-create-dialog.spec.ts` — create dialog

### E2E (Playwright)
- `frontend/e2e/settings.spec.ts` — settings page flows
- `frontend/e2e/navigation.spec.ts` — auth-gated navigation

## Implementation Notes

### Key Files
- `backend/api/auth/google/controller.js` — OAuth login, callback, test-login
- `backend/api/auth/user/controller.js` — checkToken, getUser, updateUser, refresh, sessions
- `backend/api/auth/api-key/controller.js` — API key CRUD, token exchange
- `backend/models/auth/refreshToken.js` — RefreshToken model
- `backend/models/auth/apiKey.js` — ApiKey model
- `backend/models/auth/apiKeyPermission.js` — ApiKeyPermission junction
- `frontend/src/app/guards/auth.guard.ts` — auth guard
- `frontend/src/app/interceptors/auth.interceptor.ts` — token refresh interceptor
- `frontend/src/app/services/auth.service.ts` — auth service with signals
- `frontend/src/app/components/settings/settings-page/settings-page.ts` — settings UI

### Patterns Followed
- httpOnly cookies for refresh tokens (XSS prevention)
- JWT with stateless authentication
- Automatic token refresh with request queuing
- 403 does NOT clear token (user is authenticated but lacks permission)
- API key permissions immutable after creation
- `session_id` cookie for "This device" identification

### Edge Cases
- Impersonation token: 1-hour JWT with `impersonatedBy` claim, no refresh, original token saved to `original_auth_token` localStorage
- Max 10 concurrent sessions — oldest deactivated on new login
- Expired API keys rejected at token exchange time
- `activeFlag: false` on User prevents login and token refresh
