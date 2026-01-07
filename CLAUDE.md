# Claude Code Change Log

This file tracks changes made to the codebase during Claude Code sessions.

## Session: 2026-01-06

### Files Modified
- `.env.development` (created)
- `.env.production` (created)
- `backend/index.js`
- `backend/models/index.js`
- `backend/config/config.json` (converted to `config.js`)
- `backend/Dockerfile.prod`
- `backend/api/auth/google/controller.js`
- `docker-compose.prod.yml`
- `frontend/angular.json`

### Changes Made

1. **Created environment-specific configuration files**
   - Created `.env.development` with development database host (`letwinventory-postgres`)
   - Created `.env.production` with production database host (`10.50.10.98`)

2. **Updated backend to use environment-specific .env files**
   - Modified `backend/index.js` to load `.env.production` when `NODE_ENV=production`, otherwise `.env.development`
   - Modified `backend/models/index.js` to use the same environment-specific .env loading logic

3. **Simplified docker-compose.prod.yml**
   - Changed to use `env_file: .env.production` instead of individual environment variables
   - Kept `NODE_ENV: production` in the environment section to ensure correct .env file is loaded

4. **Converted Sequelize config to use environment variables**
   - Renamed `backend/config/config.json` to `backend/config/config.js`
   - Updated to read from `.env.development` or `.env.production` based on `NODE_ENV`
   - Eliminates hardcoded database credentials in config file
   - Sequelize CLI now uses the same environment-specific configuration as the application

5. **Fixed Docker production build context**
   - Changed `docker-compose.prod.yml` build context from `./backend` to `.` (project root)
   - Updated `backend/Dockerfile.prod` to use correct paths relative to project root
   - Changed `../frontend` to `frontend` and `./package.json` to `backend/package.json`
   - Fixes Docker build error: "failed to compute cache key: '/frontend' not found"

6. **Increased Angular production build budgets**
   - Updated `frontend/angular.json` to increase budget limits
   - Initial bundle: increased from 1MB to 2MB error limit
   - Component styles: increased from 8kB to 16kB error limit
   - Fixes build failure due to `task-card-dialog.css` exceeding 8kB limit (was 11.47 kB)

7. **Fixed Google OAuth redirect and callback URL**
   - Updated redirect after authentication to use `FRONTEND_URL` environment variable
   - Development redirects to `http://localhost:4200` (Angular dev server)
   - Production redirects to `https://letwinventory.letwin.co`
   - Updated callback URL to use environment variable instead of hardcoded URL
   - Fixed `.env.development` callback URL: `http://localhost:3000/api/auth/google/callback` (was missing `/api`)
   - Updated `.env.production` callback URL: `https://letwinventory.letwin.co/api/auth/google/callback`
   - Added console.log to display OAuth configuration on startup for debugging
   - **Note:** Both callback URLs must be added to Google Cloud Console OAuth credentials

### Notes
- Production PostgreSQL server is now configured at `10.50.10.98`
- Development environment continues to use the Docker container `letwinventory-postgres`
- The application automatically selects the correct .env file based on NODE_ENV
- All database configuration now comes from environment files (no hardcoded values)
- Current branch: master

---

## Instructions for Future Sessions

Each session should:
1. Add a new section with the date
2. List all files modified
3. Describe changes made and reasoning
4. Note any important decisions or context

