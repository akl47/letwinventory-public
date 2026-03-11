# Feature: Task & Project Planning

## Context
The planning system provides a Kanban-style task board with drag-and-drop between columns, project management with color-coded tags and keyboard shortcuts, scheduled task creation from cron expressions, task time tracking via calendar integration, inline checklists, subtasks, and task history. The board supports mobile-responsive layout with snap-scroll columns and long-press drag. View preferences can be saved as defaults.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 67 | Kanban task board with drag-and-drop | Met |
| 68 | Task CRUD with project/type/priority/due date | Met |
| 69 | Move tasks between lists with rank ordering | Met |
| 70 | Task list CRUD with reordering | Met |
| 71 | Project management with color tags and shortcuts | Met |
| 72 | Keyboard shortcut project assignment on hover | Met |
| 73 | Task filtering by project/subtask | Met |
| 74 | Task history for state changes | Met |
| 75 | Task detail dialog (subtasks, date picker, time) | Met |
| 76 | Scheduled tasks from cron expressions | Met |
| 77 | Task time tracking (calendar integration) | Met |
| 78 | Mobile responsive layout | Met |
| 79 | Task inline checklist (JSONB) | Met |
| 142 | Production planning via tasks | Met |
| 150 | Operational risk management | Met |

### Kanban Board (Req #67)
- TaskList columns with drag-and-drop (CDK DragDrop)
- Tasks ordered by rank (DOUBLE for flexible positioning)
- Cross-list movement updates rank and taskListID
- Mobile: snap-scroll columns at ≤768px, long-press (500ms) drag

### Projects (Req #71, Req #72)
- Color-coded tags (tagColorHex stored without #)
- Keyboard shortcuts: digits 1-9 for project assignment on hover, 0 clears
- Toggle behavior: pressing same shortcut removes project
- Parent/child project hierarchy via parentProjectID

### Scheduled Tasks (Req #76)
- Cron expressions validated by cron-parser v4.9.0
- Backend service checks every minute
- Creates Task when `nextRunAt <= NOW()`
- Advances nextRunAt using custom AND logic for DOM+DOW (not cron-parser's OR)
- No backfilling for missed runs

### Task Checklist (Req #79)
- JSONB column: `[{id: UUID, text: string, checked: boolean}]`
- Progress badge on task card (`checked/total`)
- Add, toggle, delete operations in dialog

## API Contracts

### Tasks — `/api/planning/task/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/planning/task` | Yes | tasks.read | List tasks (filterable) |
| GET | `/api/planning/task/types` | Yes | tasks.read | List task types |
| GET | `/api/planning/task/:id` | Yes | tasks.read | Get task by ID |
| POST | `/api/planning/task` | Yes | tasks.write | Create task (creates CREATED history) |
| PUT | `/api/planning/task/:id` | Yes | tasks.write | Update task |
| PUT | `/api/planning/task/:id/move` | Yes | tasks.write | Move task `{taskListId, targetIndex}` |
| DELETE | `/api/planning/task/:id` | Yes | tasks.delete | Delete task |

### Task Lists — `/api/planning/tasklist/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/planning/tasklist` | Yes | tasks.read | List with nested tasks |
| POST | `/api/planning/tasklist` | Yes | tasks.write | Create (auto-assigns order) |
| PUT | `/api/planning/tasklist/:id` | Yes | tasks.write | Update name |
| PUT | `/api/planning/tasklist/reorder` | Yes | tasks.write | Reorder `{orderedIds}` |
| DELETE | `/api/planning/tasklist/:id` | Yes | tasks.delete | Delete list |

### Projects — `/api/planning/project/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/planning/project` | Yes | projects.read | List all projects |
| GET | `/api/planning/project/top` | Yes | projects.read | List root projects |
| GET | `/api/planning/project/:id` | Yes | projects.read | Get project by ID |
| POST | `/api/planning/project` | Yes | projects.write | Create project |
| PUT | `/api/planning/project/:id` | Yes | projects.write | Update project |
| DELETE | `/api/planning/project/:id` | Yes | projects.delete | Delete project |

### Scheduled Tasks — `/api/planning/scheduled-task/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/planning/scheduled-task` | Yes | tasks.read | List (`?includeInactive=true`) |
| GET | `/api/planning/scheduled-task/:id` | Yes | tasks.read | Get by ID |
| POST | `/api/planning/scheduled-task` | Yes | tasks.write | Create scheduled task |
| PUT | `/api/planning/scheduled-task/:id` | Yes | tasks.write | Update scheduled task |
| DELETE | `/api/planning/scheduled-task/:id` | Yes | tasks.delete | Soft delete |

### Task History — `/api/planning/taskhistory/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/planning/taskhistory` | Yes | tasks.read | List all history |
| GET | `/api/planning/taskhistory/actiontypes` | Yes | tasks.read | List action types |
| GET | `/api/planning/taskhistory/task/:taskId` | Yes | tasks.read | History for task |

### Task Time Tracking — `/api/planning/task-time-tracking/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| POST | `/api/planning/task-time-tracking` | Yes | tasks.write | Create entry |
| GET | `/api/planning/task-time-tracking/task/:taskId` | Yes | tasks.read | By task |
| GET | `/api/planning/task-time-tracking/user` | Yes | tasks.read | By current user |
| DELETE | `/api/planning/task-time-tracking/:id` | Yes | tasks.delete | Delete by ID |
| DELETE | `/api/planning/task-time-tracking/event/:calendarEventId` | Yes | tasks.delete | Delete by event |

## UI Design

### Task Board (`/tasks`)
- **Columns:** task lists rendered as Kanban columns
- **Task cards:** name, project chip (colored), type icon, due date, checklist progress, subtask indicator
- **Drag-and-drop:** CDK DragDrop for cross-list movement
- **Add task:** inline input at bottom of each column
- **Edit mode:** toggle for list rename/reorder/delete
- **Sub-toolbar:** project filter chips (multi-select), "No Project" toggle, subtasks toggle, save default/revert

### Task Card Dialog (opened on card click)
- **Title editing** with inline input
- **Description** with textarea
- **Project** dropdown
- **Due date** with calendar picker (rounds to 15-min intervals)
- **Time estimate** input
- **Subtasks** list with add/toggle/complete
- **Checklist** with add/toggle/delete and progress bar
- **History drawer** with timeline of actions

### Projects List (`/projects`)
- **Table:** name, short name, color chip, keyboard shortcut, actions
- **Search, sorting, pagination**
- **Create/edit dialog:** name, short name, color picker, keyboard shortcut (1-9), parent project

### Scheduled Tasks List (`/scheduled-tasks`)
- **Table:** name, cron expression (with English translation), next run, last run, task list, project, actions
- **Inactive filter toggle**
- **Create/edit dialog:** name, description, cron expression, timezone, task list, project, due date offset

### Mobile Layout (Req #78)
- Columns snap-scroll (`scroll-snap-type: x mandatory`), each column 100vw
- CDK drag delay: 500ms touch (long-press), 0ms mouse
- Auto-scroll during drag (48px edge zone)
- Sub-toolbar collapsible on mobile

## Database Changes

### Tasks Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(100) | NOT NULL |
| description | TEXT | nullable |
| doneFlag | BOOLEAN | default false |
| dueDate | DATE | nullable |
| dueDateNotifiedAt | DATE | nullable |
| timeEstimate | FLOAT | nullable |
| taskTypeEnum | STRING | default 'normal' |
| rank | DOUBLE | for ordering |
| taskListID | INTEGER | FK → TaskLists |
| ownerUserID | INTEGER | FK → Users |
| projectID | INTEGER | FK → Projects, nullable |
| parentTaskID | INTEGER | FK → Tasks (self-reference), nullable |
| checklist | JSONB | nullable, default null |
| completeWithChildren | BOOLEAN | default false |
| activeFlag | BOOLEAN | default true |

### TaskLists Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(20) | NOT NULL |
| order | INTEGER | NOT NULL |
| activeFlag | BOOLEAN | default true |

### Projects Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(100) | NOT NULL |
| shortName | STRING(6) | nullable |
| tagColorHex | STRING(6) | stored without # |
| keyboardShortcut | STRING(1) | UNIQUE, nullable (digits 1-9) |
| parentProjectID | INTEGER | FK → Projects (self-reference), nullable |
| activeFlag | BOOLEAN | default true |

### ScheduledTasks Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(100) | NOT NULL |
| description | TEXT | nullable |
| taskListID | INTEGER | FK → TaskLists |
| projectID | INTEGER | FK → Projects, nullable |
| taskTypeEnum | STRING | default 'scheduled' |
| timeEstimate | FLOAT | nullable |
| cronExpression | STRING | NOT NULL |
| timezone | STRING | default 'America/Los_Angeles' |
| dueDateOffsetHours | INTEGER | nullable |
| nextRunAt | DATE | NOT NULL |
| lastRunAt | DATE | nullable |
| activeFlag | BOOLEAN | default true |

### TaskHistory Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| taskID | INTEGER | FK → Tasks |
| userID | INTEGER | FK → Users |
| actionID | INTEGER | FK → TaskHistoryActionTypes |
| fromID | INTEGER | nullable |
| toID | INTEGER | nullable |
| createdAt | DATE | NOT NULL |

Action types seeded: CREATED, ADD_TO_PROJECT, ADD_PRIORITY, CHANGE_STATUS, MOVE_LIST

### TaskTimeTracking Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| taskID | INTEGER | FK → Tasks |
| userID | INTEGER | FK → Users |
| calendarEventID | STRING | nullable |
| calendarID | STRING | nullable |

### Relevant Migrations
- `20260112000000-initial.js` — Tasks, TaskLists, Projects, ScheduledTasks, TaskHistory, TaskTimeTracking

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/planning/task.test.js` — types, list, filter, get, create (with history), update, delete, checklist
- `backend/tests/__tests__/planning/taskList.test.js` — list, order, create, update, reorder, delete
- `backend/tests/__tests__/planning/project.test.js` — list, top-level, get, create, update, delete
- `backend/tests/__tests__/planning/scheduledTask.test.js` — CRUD operations
- `backend/tests/__tests__/services/scheduledTaskService.test.js` — creates task, advances nextRunAt, skips inactive/future
- `backend/tests/__tests__/planning/taskHistory.test.js` — list, action types, by task
- `backend/tests/__tests__/planning/taskTimeTracking.test.js` — create, delete by ID, delete by event

### Frontend (Karma)
- `frontend/src/app/components/tasks/task-list-view/task-list-view.spec.ts` — initial state, toggles, list operations, filter handlers, URL params
- `frontend/src/app/components/tasks/task-list/task-list.spec.ts` — filtered tasks, project filtering, add/cancel task, drag delay
- `frontend/src/app/components/tasks/task-card/task-card.spec.ts` — checklist progress, keyboard shortcuts, toggle complete
- `frontend/src/app/components/tasks/task-card-dialog/task-card-dialog.spec.ts` — checklist operations, title editing, subtasks
- `frontend/src/app/components/tasks/sub-toolbar/sub-toolbar.spec.ts` — project filters, toggles, URL initial values
- `frontend/src/app/components/tasks/history-drawer/history-drawer.spec.ts` — action labels, load more
- `frontend/src/app/components/projects/projects-list-view/projects-list-view.spec.ts` — data loading, search, sorting, pagination
- `frontend/src/app/components/projects/project-edit-dialog/project-edit-dialog.spec.ts` — create/edit, shortcuts, color
- `frontend/src/app/components/scheduled-tasks/scheduled-tasks-list-view/scheduled-tasks-list-view.spec.ts` — data loading, cron translation
- `frontend/src/app/components/scheduled-tasks/scheduled-task-edit-dialog/scheduled-task-edit-dialog.spec.ts` — create/edit, validation
- `frontend/src/app/services/task-view-preferences.service.spec.ts` — save/load defaults

### E2E (Playwright)
- `frontend/e2e/tasks.spec.ts` — task board and checklist operations
- `frontend/e2e/projects.spec.ts` — project management
- `frontend/e2e/scheduled-tasks.spec.ts` — scheduled task operations

## Implementation Notes

### Key Files
- `backend/api/planning/task/controller.js` — task CRUD + move
- `backend/api/planning/tasklist/controller.js` — list CRUD + reorder
- `backend/api/planning/project/controller.js` — project CRUD
- `backend/api/planning/scheduled-task/controller.js` — scheduled task CRUD
- `backend/services/scheduledTaskService.js` — hourly cron task creation
- `backend/models/planning/` — Task, TaskList, Project, ScheduledTask, TaskHistory models
- `frontend/src/app/components/tasks/` — all task board components
- `frontend/src/app/components/projects/` — project components
- `frontend/src/app/components/scheduled-tasks/` — scheduled task components
- `frontend/src/app/services/task-view-preferences.service.ts` — cookie-based view defaults

### Patterns Followed
- Rank-based ordering (DOUBLE) for flexible drag-and-drop positioning
- Task history records all state changes with userID
- `completeWithChildren` auto-completes parent when all subtasks done
- Keyboard shortcut 0 reserved for "no project"
- `tagColorHex` stored without `#` prefix
- Scheduled task service uses AND logic for DOM+DOW (custom, not cron-parser default)
- Auto-scroll during drag uses rAF loop, runs outside Angular zone

### Edge Cases
- Keyboard shortcut digits 1-9 are unique per project, nullable
- Scheduled tasks: no backfilling — if server was down, missed runs are skipped
- `dueDateNotifiedAt` prevents duplicate notification sends
- Mobile drag delay: 500ms for touch, 0ms for mouse
