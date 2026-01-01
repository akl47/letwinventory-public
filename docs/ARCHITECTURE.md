# Architecture Overview

This document describes the system architecture of LetWinInventory.

## System Overview

LetWinInventory is a full-stack web application following a three-tier architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│                   Angular SPA (Port 4200)                       │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ HTTP/REST
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Application Layer                          │
│                Express.js API (Port 3000)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Auth     │  │  Inventory  │  │  Planning   │              │
│  │   Module    │  │   Module    │  │   Module    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ Sequelize ORM
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Data Layer                               │
│                 PostgreSQL 13 (Port 5432)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| Angular 21 | SPA framework |
| Angular Material | UI component library |
| RxJS | Reactive programming |
| TypeScript | Type-safe JavaScript |

### Backend

| Technology | Purpose |
|------------|---------|
| Node.js | Runtime environment |
| Express.js | Web framework |
| Sequelize | ORM |
| Passport.js | Authentication |
| JWT | Token-based auth |

### Infrastructure

| Technology | Purpose |
|------------|---------|
| Docker | Containerization |
| Docker Compose | Container orchestration |
| PostgreSQL 13 | Database |
| pgAdmin 4 | Database management |

## Application Modules

### Authentication Module

Handles user authentication and authorization.

```
┌─────────────────────────────────────────┐
│           Authentication Flow           │
├─────────────────────────────────────────┤
│  1. User clicks "Sign in with Google"   │
│  2. Redirect to Google OAuth            │
│  3. Google returns auth code            │
│  4. Exchange code for user info         │
│  5. Create/update user in database      │
│  6. Generate JWT token                  │
│  7. Return token to client              │
└─────────────────────────────────────────┘
```

**Components:**
- Google OAuth 2.0 strategy (Passport.js)
- JWT token generation (24-hour expiry)
- Token verification middleware
- User model

### Inventory Module

Manages physical inventory tracking.

```
┌──────────────────────────────────────────────────────────────┐
│                    Inventory Hierarchy                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Location (Root)                                            │
│   ├── Location (Child)                                       │
│   │   ├── Box ──────────┐                                   │
│   │   └── Box           │                                   │
│   └── Location (Child)  │                                   │
│       └── Box           │                                   │
│                         ▼                                   │
│                    ┌─────────┐                              │
│   Parts ──────────►│  Trace  │◄─────── OrderItems          │
│                    └─────────┘                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Components:**
- Parts catalog with categories
- Hierarchical locations
- Boxes with barcode tracking
- Traces for part-location mapping
- Auto-generated barcodes

### Order Module

Manages purchase orders and inventory replenishment.

```
┌──────────────────────────────────────────────────────────────┐
│                     Order Workflow                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌──────────┐   │
│   │ Pending │──►│ Ordered │──►│ Shipped │──►│ Received │   │
│   └─────────┘   └─────────┘   └─────────┘   └──────────┘   │
│        │                                          │         │
│        ▼                                          ▼         │
│   ┌───────────┐                           ┌─────────────┐   │
│   │ Cancelled │                           │ Create Trace │  │
│   └───────────┘                           └─────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Components:**
- Orders with status tracking
- Order items linked to parts
- Order line types (standard, shipping, tax)
- Vendor and tracking information

### Planning Module

Manages projects and task tracking.

```
┌──────────────────────────────────────────────────────────────┐
│                    Project Structure                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Project (Parent)                                           │
│   ├── Project (Child)                                        │
│   │   ├── TaskList                                          │
│   │   │   ├── Task                                          │
│   │   │   │   └── Task (Subtask)                           │
│   │   │   └── Task                                          │
│   │   └── TaskList                                          │
│   └── Project (Child)                                        │
│                                                              │
│   Task changes ──► TaskHistory (Audit Trail)                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Components:**
- Hierarchical projects
- Task lists for organization
- Tasks with subtasks
- Task history for auditing
- User assignment

## API Architecture

### Route Organization

```
/api
├── /auth
│   ├── /google          # Google OAuth
│   │   ├── GET /        # Initiate login
│   │   ├── GET /callback# OAuth callback
│   │   ├── GET /me      # Current user
│   │   └── POST /logout # Logout
│   └── /user            # User management
│
├── /inventory
│   ├── /barcode         # Barcode operations
│   ├── /box             # Box CRUD
│   ├── /location        # Location hierarchy
│   ├── /order           # Orders CRUD
│   ├── /orderitem       # Order line items
│   ├── /part            # Parts catalog
│   └── /trace           # Part tracking
│
└── /planning
    ├── /project         # Projects CRUD
    ├── /task            # Tasks CRUD
    ├── /taskhistory     # Task audit log
    └── /tasklist        # Task lists
```

### Request Flow

```
┌──────────┐    ┌─────────────┐    ┌────────────┐    ┌──────────┐
│  Client  │───►│  Middleware │───►│ Controller │───►│  Model   │
└──────────┘    └─────────────┘    └────────────┘    └──────────┘
                     │                   │                │
                     ▼                   ▼                ▼
              ┌─────────────┐    ┌────────────┐    ┌──────────┐
              │ checkToken  │    │  Business  │    │ Sequelize│
              │ bodyValidator    │   Logic    │    │  Query   │
              └─────────────┘    └────────────┘    └──────────┘
```

### Middleware Stack

1. **CORS** - Cross-origin resource sharing
2. **Body Parser** - JSON request parsing
3. **checkToken** - JWT verification
4. **bodyValidator** - Request validation
5. **Error Handler** - Centralized error handling

## Frontend Architecture

### Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        App Component                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Navigation Bar                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Router Outlet                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │  Inventory  │  │   Orders    │  │   Planning  │     │   │
│  │  │    View     │  │    View     │  │    View     │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Service Layer

```typescript
// Service pattern
@Injectable({ providedIn: 'root' })
export class PartService {
  private apiUrl = '/api/inventory/part';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Part[]> {
    return this.http.get<Part[]>(this.apiUrl);
  }

  create(part: Part): Observable<Part> {
    return this.http.post<Part>(this.apiUrl, part);
  }
}
```

### State Management

- **Services** - Singleton services for API calls
- **RxJS** - Reactive data streams
- **Component State** - Local component state via signals/properties

### Route Guards

```typescript
// Auth guard pattern
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
```

## Data Flow

### Read Operation

```
┌────────┐   GET /api/inventory/part   ┌─────────┐   SELECT *   ┌────────┐
│ Client │ ─────────────────────────► │ Backend │ ───────────► │   DB   │
└────────┘                            └─────────┘              └────────┘
    ▲                                      │                       │
    │                                      │                       │
    │         JSON Response               │    Result Set        │
    └──────────────────────────────────────┴───────────────────────┘
```

### Write Operation

```
┌────────┐   POST /api/inventory/part   ┌─────────┐
│ Client │ ────────────────────────────►│ Backend │
└────────┘                              └─────────┘
                                             │
                                    ┌────────┼────────┐
                                    ▼        ▼        ▼
                              ┌─────────┐ ┌─────┐ ┌─────────┐
                              │Validate │ │Auth │ │ Create  │
                              │  Body   │ │Check│ │ Record  │
                              └─────────┘ └─────┘ └─────────┘
```

## Security Architecture

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    JWT Authentication                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Login Request                                               │
│     ┌────────┐              ┌─────────┐                        │
│     │ Client │──────────────►│ Google  │                        │
│     └────────┘              └─────────┘                        │
│                                  │                              │
│  2. OAuth Token                  │                              │
│     ┌────────┐              ┌─────────┐                        │
│     │ Client │◄──────────────│ Google  │                        │
│     └────────┘              └─────────┘                        │
│                                                                  │
│  3. Exchange for JWT                                            │
│     ┌────────┐              ┌─────────┐                        │
│     │ Client │──────────────►│ Backend │                        │
│     └────────┘              └─────────┘                        │
│         │                        │                              │
│         │  JWT Token             │ Create/Update User           │
│         │◄───────────────────────│                              │
│                                                                  │
│  4. Authenticated Requests                                      │
│     ┌────────┐  Authorization: Bearer <token>  ┌─────────┐     │
│     │ Client │────────────────────────────────►│ Backend │     │
│     └────────┘                                 └─────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Security Layers

1. **Transport** - HTTPS encryption
2. **Authentication** - Google OAuth + JWT
3. **Authorization** - Token-based access control
4. **Validation** - Request body validation
5. **Database** - Parameterized queries via ORM

## Deployment Architecture

### Development Environment

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Compose Network                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │    Frontend     │     │     Backend     │                   │
│  │   (Port 4200)   │────►│   (Port 3000)   │                   │
│  │   Angular Dev   │     │    Nodemon      │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                  │                              │
│                                  ▼                              │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │    pgAdmin      │────►│   PostgreSQL    │                   │
│  │   (Port 5050)   │     │   (Port 5433)   │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Production Environment

```
┌─────────────────────────────────────────────────────────────────┐
│                    Production Deployment                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐                                           │
│  │    Internet     │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                           │
│  │  Load Balancer  │                                           │
│  │    / Nginx      │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│     ┌─────┴─────┐                                              │
│     ▼           ▼                                              │
│  ┌──────┐   ┌──────┐    ┌──────────────┐                      │
│  │ API  │   │ API  │───►│  PostgreSQL  │                      │
│  │  #1  │   │  #2  │    │   Primary    │                      │
│  └──────┘   └──────┘    └──────────────┘                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Design Patterns

### Backend Patterns

| Pattern | Usage |
|---------|-------|
| MVC | Route → Controller → Model |
| Repository | Sequelize models abstract DB access |
| Middleware | Cross-cutting concerns (auth, validation) |
| Factory | Model initialization |

### Frontend Patterns

| Pattern | Usage |
|---------|-------|
| Component | UI encapsulation |
| Service | Business logic and API calls |
| Observable | Async data streams |
| Guard | Route protection |
| Interceptor | HTTP request/response handling |

## Scalability Considerations

### Horizontal Scaling

- Stateless backend allows multiple instances
- Session data stored in JWT (client-side)
- Database connection pooling

### Vertical Scaling

- Optimize database queries
- Add indexes for frequent queries
- Implement caching layer (Redis)

### Performance Optimizations

- Frontend lazy loading
- API response pagination
- Database query optimization
- Static asset caching
