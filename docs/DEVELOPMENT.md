# Development Guide

This guide covers setting up a development environment and development workflows for LetWinInventory.

## Prerequisites

- Docker v20.10.11+
- Docker Compose v2.2.1+
- Node.js 16+ (optional, for local development)
- npm 8+
- Git

## Development Setup

### 1. Clone and Configure

```bash
git clone <repository-url>
cd letwinventory-public

# Copy configuration files
cp backend/config/config.json.example backend/config/config.json
cp .env.example .env
```

### 2. Install Dependencies

```bash
# Frontend dependencies
cd frontend
npm install --legacy-peer-deps

# Backend dependencies
cd ../backend
npm install
```

### 3. Start Development Environment

```bash
# From project root
docker compose up
```

This starts:
- Backend API at http://localhost:3000
- Frontend at http://localhost:4200
- PostgreSQL at localhost:5433
- pgAdmin at http://localhost:5050

### 4. Initialize Database

```bash
# Connect to backend container
docker exec -it letwinventory-backend /bin/bash

# Run migrations
sequelize db:migrate

# Seed initial data
sequelize db:seed:all
```

## Project Structure

### Backend (`/backend`)

```
backend/
├── api/                    # API routes organized by feature
│   ├── auth/               # Authentication routes
│   │   ├── google/         # Google OAuth
│   │   └── user/           # User management
│   ├── inventory/          # Inventory routes
│   │   ├── barcode/        # Barcode operations
│   │   ├── box/            # Box management
│   │   ├── location/       # Location hierarchy
│   │   ├── order/          # Purchase orders
│   │   ├── orderitem/      # Order line items
│   │   ├── part/           # Parts catalog
│   │   └── trace/          # Part location tracking
│   └── planning/           # Planning routes
│       ├── project/        # Projects
│       ├── task/           # Tasks
│       ├── taskhistory/    # Task audit trail
│       └── tasklist/       # Task lists
├── auth/                   # Passport & JWT configuration
├── middleware/             # Express middleware
│   ├── checkToken.js       # JWT verification
│   └── bodyValidator.js    # Request validation
├── migrations/             # Sequelize migrations
├── models/                 # Sequelize models
├── seeders/                # Database seeders
├── util/                   # Utility functions
├── index.js                # Application entry point
└── package.json
```

### Frontend (`/frontend`)

```
frontend/
└── src/
    └── app/
        ├── components/     # UI components
        │   ├── common/     # Shared components (nav)
        │   ├── inventory/  # Inventory views
        │   ├── orders/     # Order management
        │   ├── pages/      # Page-level components
        │   ├── parts/      # Parts views
        │   └── tasks/      # Task management
        ├── guards/         # Route guards
        ├── models/         # TypeScript interfaces
        ├── services/       # HTTP services
        └── app.routes.ts   # Route configuration
```

## Development Workflows

### Running the Backend Only

```bash
docker compose up letwinventory-backend letwinventory-postgres
```

### Running the Frontend Only

```bash
cd frontend
npm start
```

The frontend will run at http://localhost:4200 and proxy API calls to the backend.

### Hot Reloading

Both frontend and backend support hot reloading:
- **Backend:** Uses nodemon, automatically restarts on file changes
- **Frontend:** Angular CLI watches for changes and rebuilds

### Database Operations

```bash
# Connect to backend container
docker exec -it letwinventory-backend /bin/bash

# Create a new migration
sequelize migration:generate --name add-new-field

# Run pending migrations
sequelize db:migrate

# Undo last migration
sequelize db:migrate:undo

# Create a new seeder
sequelize seed:generate --name add-sample-data

# Run seeders
sequelize db:seed:all
```

### Direct Database Access

Using pgAdmin:
1. Open http://localhost:5050
2. Login: admin@admin.com / root
3. Add server with host `letwinventory-postgres`

Using psql:
```bash
docker exec -it letwinventory-postgres psql -U postgres -d letwinventory
```

## Adding New Features

### Adding a New API Endpoint

1. **Create the route folder:**
   ```
   backend/api/<module>/<feature>/
   ├── routes.js     # Express routes
   └── controller.js # Route handlers
   ```

2. **Define routes in `routes.js`:**
   ```javascript
   const router = require('express').Router();
   const controller = require('./controller');
   const checkToken = require('../../../middleware/checkToken.js');

   router.get('/', checkToken, controller.getAll);
   router.post('/', checkToken, controller.create);

   module.exports = router;
   ```

3. **Implement controller in `controller.js`:**
   ```javascript
   const { ModelName } = require('../../../models');

   exports.getAll = async (req, res, next) => {
     try {
       const items = await ModelName.findAll();
       res.json(items);
     } catch (error) {
       next(error);
     }
   };
   ```

4. **Register the route in `index.js`:**
   ```javascript
   app.use('/api/<module>/<feature>', require('./api/<module>/<feature>/routes'));
   ```

### Adding a New Model

1. **Create migration:**
   ```bash
   sequelize migration:generate --name create-new-model
   ```

2. **Edit migration file in `backend/migrations/`:**
   ```javascript
   module.exports = {
     up: async (queryInterface, Sequelize) => {
       await queryInterface.createTable('NewModels', {
         id: {
           allowNull: false,
           autoIncrement: true,
           primaryKey: true,
           type: Sequelize.INTEGER
         },
         name: {
           type: Sequelize.STRING,
           allowNull: false
         },
         createdAt: {
           allowNull: false,
           type: Sequelize.DATE
         },
         updatedAt: {
           allowNull: false,
           type: Sequelize.DATE
         }
       });
     },
     down: async (queryInterface) => {
       await queryInterface.dropTable('NewModels');
     }
   };
   ```

3. **Create model file in `backend/models/<module>/`:**
   ```javascript
   'use strict';
   const { Model } = require('sequelize');

   module.exports = (sequelize, DataTypes) => {
     class NewModel extends Model {
       static associate(models) {
         // Define associations here
       }
     }

     NewModel.init({
       id: {
         allowNull: false,
         autoIncrement: true,
         primaryKey: true,
         type: DataTypes.INTEGER
       },
       name: {
         type: DataTypes.STRING,
         allowNull: false
       }
     }, {
       sequelize,
       modelName: 'NewModel',
     });

     return NewModel;
   };
   ```

4. **Run migration:**
   ```bash
   sequelize db:migrate
   ```

### Adding a New Angular Component

```bash
cd frontend

# Generate a component
ng generate component components/<module>/<component-name>

# Generate a service
ng generate service services/<service-name>
```

### Adding Request Validation

Edit `backend/middleware/bodyValidator.js`:

```javascript
exports.newModel = (req, res, next) => {
  const required = ['name', 'requiredField'];
  const schema = {
    name: { type: 'STRING', required: true },
    requiredField: { type: 'INTEGER', required: true },
    optionalField: { type: 'STRING', required: false }
  };

  // Validation logic
  for (const field of required) {
    if (!req.body[field]) {
      return res.status(400).json({ error: `${field} is required` });
    }
  }
  next();
};
```

## Code Style

### Backend (JavaScript)

- Use ES6+ features
- Async/await for asynchronous operations
- Express error handling with next()
- Consistent naming: camelCase for variables/functions

### Frontend (TypeScript)

- Follow Angular style guide
- Use strict TypeScript
- RxJS for reactive programming
- Prettier for formatting (configured in package.json)

## Testing

### Backend Testing

Currently no test framework is configured. Recommended setup:

```bash
npm install --save-dev jest supertest
```

### Frontend Testing

```bash
cd frontend
npm test
```

Uses Vitest for unit testing.

## Debugging

### Backend Debugging

1. **View logs:**
   ```bash
   docker logs -f letwinventory-backend
   ```

2. **Add console.log statements** - nodemon will restart automatically

3. **Connect debugger:**
   - Add `--inspect` flag to nodemon in Dockerfile
   - Connect Chrome DevTools to `chrome://inspect`

### Frontend Debugging

1. Open browser DevTools (F12)
2. Use Angular DevTools extension
3. Enable source maps in angular.json

### Database Debugging

```bash
# View database logs
docker logs -f letwinventory-postgres

# Query directly
docker exec -it letwinventory-postgres psql -U postgres -d letwinventory
```

## Common Issues

### "legacy-peer-deps" Error

Angular 21 requires `--legacy-peer-deps` flag:
```bash
npm install --legacy-peer-deps
```

### Database Connection Refused

Ensure PostgreSQL is running and the database exists:
```bash
docker compose ps  # Check container status
```

### Port Already in Use

Stop conflicting services or change ports in `.env`:
```
BACKEND_PORT=3001
PGADMIN_PORT=5051
```

### Migration Errors

Reset and re-run migrations:
```bash
sequelize db:migrate:undo:all
sequelize db:migrate
sequelize db:seed:all
```
