# LetWinInventory

A full-stack inventory management and project planning system built with Angular, Express.js, and PostgreSQL.

## Features

- **Inventory Management**: Track parts, boxes, and storage locations with barcode support
- **Order Management**: Create and manage purchase orders with status tracking
- **Barcode System**: Auto-generated barcodes with category prefixes for physical tracking
- **Project Planning**: Manage projects and tasks with hierarchical organization
- **Google OAuth**: Secure authentication via Google accounts

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Angular 21, Angular Material |
| Backend | Node.js, Express.js |
| Database | PostgreSQL 13 |
| ORM | Sequelize |
| Auth | Google OAuth 2.0, JWT |
| Container | Docker, Docker Compose |

## Prerequisites

- Docker v20.10.11+
- Docker Compose v2.2.1+
- Node.js 16+ (for local development)
- npm 8+

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd letwinventory-public
   ```

2. **Install dependencies**
   ```bash
   cd frontend && npm install --legacy-peer-deps
   cd ../backend && npm install
   cd ..
   ```

3. **Configure environment**
   ```bash
   cp backend/config/config.json.example backend/config/config.json
   cp .env.example .env
   ```

4. **Configure Google OAuth** (optional)

   Edit `.env` and add your Google OAuth credentials:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

5. **Start the services**
   ```bash
   docker compose up
   ```

6. **Create the database**

   Open pgAdmin at http://localhost:5050
   - Email: `admin@admin.com`
   - Password: `root`

   Add a new server connection:
   - Host: `letwinventory-postgres`
   - Port: `5432`
   - Username: `postgres`
   - Password: `postgres`

   Create a database named `letwinventory`

7. **Run migrations and seeders**
   ```bash
   docker exec -it letwinventory-backend /bin/bash
   sequelize db:migrate
   sequelize db:seed:all
   ```

8. **Access the application**

   Open http://localhost:4200

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:4200 | Angular web application |
| Backend API | http://localhost:3000 | Express.js REST API |
| pgAdmin | http://localhost:5050 | Database management |
| PostgreSQL | localhost:5433 | Database server |

## Project Structure

```
letwinventory-public/
├── backend/              # Express.js API server
│   ├── api/              # Route handlers by feature
│   ├── models/           # Sequelize ORM models
│   ├── migrations/       # Database migrations
│   ├── seeders/          # Initial data seeders
│   ├── middleware/       # Auth & validation middleware
│   └── auth/             # Passport & JWT configuration
├── frontend/             # Angular SPA
│   └── src/app/
│       ├── components/   # UI components
│       ├── services/     # HTTP services
│       ├── guards/       # Route guards
│       └── models/       # TypeScript interfaces
├── docs/                 # Documentation
└── docker-compose.yml    # Container orchestration
```

## Documentation

- [API Reference](docs/API.md) - REST API endpoints documentation
- [Database Schema](docs/DATABASE.md) - Database models and relationships
- [Architecture](docs/ARCHITECTURE.md) - System architecture overview
- [Development Guide](docs/DEVELOPMENT.md) - Development setup and guidelines
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment instructions
- [Proxmox Deployment](docs/PROXMOX-DEPLOYMENT.md) - Deploy on Proxmox server

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for JWT tokens | `Test Secret` |
| `BACKEND_PORT` | Backend server port | `3000` |
| `PGADMIN_PORT` | pgAdmin web interface port | `5050` |
| `DB_HOST` | Database host | `letwinventory-postgres` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `letwinventory` |
| `DB_USERNAME` | Database username | `postgres` |
| `DB_PASSWORD` | Database password | `postgres` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | - |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | - |

## License

This project is proprietary software.
