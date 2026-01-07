# Production Deployment Guide

## Overview

The production setup builds the Angular frontend and serves it along with the backend API from a single Node.js server. This eliminates the need for a separate frontend container and simplifies deployment.

## Architecture

- **Single Container**: The backend container serves both the Angular static files and the API
- **External Database**: Connects to an existing PostgreSQL database (not managed by Docker Compose)
- **Production Build**: Angular is built in production mode for optimized performance

## Files

- `docker-compose.prod.yml` - Production Docker Compose configuration
- `backend/Dockerfile.prod` - Multi-stage Dockerfile that builds frontend and backend
- `backend/index.js` - Updated to serve static files when `NODE_ENV=production`

## Prerequisites

1. An existing PostgreSQL database
2. Environment variables configured in `.env` file

## Environment Variables

Make sure your `.env` file includes:

```bash
# Backend
BACKEND_PORT=3000
NODE_ENV=production

# Database (external)
DB_HOST=your-postgres-host
DB_NAME=your-database-name
DB_SCHEMA=public
DB_USERNAME=your-db-username
DB_PASSWORD=your-db-password
DB_DIALECT=postgres
DB_PORT=5432

# Authentication
JWT_SECRET=your-jwt-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=your-callback-url
```

## Building and Running

### Build the production image:
```bash
docker-compose -f docker-compose.prod.yml build
```

### Run the production container:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Stop the production container:
```bash
docker-compose -f docker-compose.prod.yml down
```

### View logs:
```bash
docker-compose -f docker-compose.prod.yml logs -f
```

## Accessing the Application

Once running, the application will be available at:
- **Frontend & API**: `http://localhost:${BACKEND_PORT}`
- **API Endpoints**: `http://localhost:${BACKEND_PORT}/api/*`

All routes except `/api/*` will serve the Angular application, allowing client-side routing to work correctly.

## Development vs Production

| Feature | Development (`docker-compose.yml`) | Production (`docker-compose.prod.yml`) |
|---------|-----------------------------------|---------------------------------------|
| Frontend | Separate container with live reload | Built and served by backend |
| Backend | Hot reload with nodemon | Production mode |
| Database | Includes PostgreSQL container | Connects to external database |
| Ports | Frontend: 4200, Backend: 3000 | Single port (BACKEND_PORT) |
| Build | No build step | Optimized production build |

## Troubleshooting

### Frontend files not found
- Ensure the Angular build completed successfully in the Docker build logs
- Check that `/usr/src/public` exists in the container
- Verify `NODE_ENV=production` is set

### Database connection errors
- Verify your external PostgreSQL database is accessible
- Check DB_HOST is reachable from the Docker container
- Confirm database credentials are correct

### Port conflicts
- Make sure the BACKEND_PORT is not already in use
- Check that no other containers are using the same port
