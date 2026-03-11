# Feature: Notifications

## Context
The notification system provides web push notifications via the Web Push API with VAPID authentication. Users receive real-time alerts for task due date reminders and scheduled task creation. Push subscriptions are managed per user/device combination. The notification service runs background checks every minute for eligible tasks. Expired subscriptions are automatically cleaned up. Configuration is managed through the settings page.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 91 | Web push via VAPID/service worker | Met |
| 92 | Push subscription management per user | Met |
| 93 | Due date reminders and scheduled task notifications | Met |

### Web Push (Req #91)
- VAPID keys configured per environment (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`)
- Backend uses `web-push` library
- Service worker (`sw.js`) handles push events and notification click navigation
- PWA manifest (`manifest.webmanifest`) enables Add to Home Screen

### Subscription Management (Req #92)
- PushSubscription model: userID, endpoint (unique), p256dh, auth, userAgent
- Upsert by endpoint on subscribe
- Ownership validation on delete
- Expired subscriptions (410 Gone) cleaned up automatically

### Due Date Reminders (Req #93)
- Service checks every minute for tasks with `dueDate` within reminder window
- `dueDateNotifiedAt IS NULL` prevents duplicate sends
- After notification: sets `dueDateNotifiedAt = NOW()`
- Scheduled task service calls `sendScheduledTaskNotification()` after creating tasks
- Notification payload: `{title, body, url}`

## API Contracts

### Push Subscriptions — `/api/config/push-subscription/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/config/push-subscription` | Yes | — | List current user's subscriptions |
| POST | `/api/config/push-subscription` | Yes | — | Upsert subscription (by endpoint) |
| DELETE | `/api/config/push-subscription/:id` | Yes | — | Remove subscription (ownership validated) |

### VAPID & Test — `/api/config/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/config/vapid-public-key` | No | — | Get VAPID public key |
| POST | `/api/config/test-notification` | Yes | — | Send test push notification |

### Notification Preferences — `/api/config/notification-preference/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/config/notification-preference` | Yes | — | Get current user's preferences |
| PUT | `/api/config/notification-preference` | Yes | — | Update preferences |

Note: config/* routes are exempt from permission enforcement (auth only).

## UI Design

### Settings Page — Notifications Section
- **Permission state:** shows current browser notification permission (granted/denied/default)
- **Enable/Disable toggle:** requests browser permission, subscribes/unsubscribes
- **Device list:** shows all subscribed devices with platform detection (iOS, Android, Windows, macOS, Linux)
- **Remove device:** delete subscription for specific device
- **Test notification:** sends test push to verify setup
- **Loading state:** during subscribe/unsubscribe operations

## Database Changes

### PushSubscriptions Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| userID | INTEGER | FK → Users, ON DELETE CASCADE |
| endpoint | TEXT | NOT NULL, UNIQUE |
| p256dh | TEXT | NOT NULL |
| auth | TEXT | NOT NULL |
| userAgent | STRING(255) | nullable |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### NotificationPreferences Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| userID | INTEGER | FK → Users, UNIQUE |
| enabled | BOOLEAN | default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### Tasks Table Addition
| Column | Type | Constraints |
|--------|------|-------------|
| dueDateNotifiedAt | DATE | nullable |

### Relevant Migrations
- `20260112000000-initial.js` — PushSubscriptions, NotificationPreferences, Tasks.dueDateNotifiedAt

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/config/pushSubscription.test.js` — subscribe, list user's subs, unsubscribe, wrong user 404, 401 without auth

### Frontend (Karma)
- `frontend/src/app/services/notification.service.spec.ts` — VAPID key fetch, subscription CRUD, permission state, subscribeToPush (denied/granted/existing cleanup), unsubscribe
- `frontend/src/app/components/settings/settings-page/settings-page.spec.ts` — load permission state, load subscriptions, device labels, remove device, test notification, enable notifications

### E2E (Playwright)
- `frontend/e2e/settings.spec.ts` — settings page notifications section

## Implementation Notes

### Key Files
- `backend/api/config/push-subscription/controller.js` — subscription CRUD
- `backend/services/notificationService.js` — background due date checking, push sending
- `backend/models/common/pushSubscription.js` — PushSubscription model
- `frontend/src/app/services/notification.service.ts` — notification service
- `frontend/src/app/components/settings/settings-page/settings-page.ts` — notification UI
- `frontend/src/sw.js` — service worker for push events

### Patterns Followed
- VAPID authentication for web push
- Upsert by endpoint (handles resubscription on same device)
- `dueDateNotifiedAt` prevents duplicate notifications
- Expired subscriptions (410) auto-cleaned on send failure
- Config routes exempt from permission enforcement

### Edge Cases
- VAPID keys not configured → `/vapid-public-key` returns 500
- Browser denies notification permission → graceful handling
- Service worker not registered → notifications don't work
- Scheduled task notifications sent immediately after task creation
- Multiple devices per user each receive independent notifications
- Currently on `pwa` branch, pending merge to master
