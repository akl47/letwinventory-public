# Deployment Guide

This guide covers deploying LetWinInventory to production environments.

## Deployment Options

1. **Docker Compose** - Single server deployment
2. **Container Orchestration** - Kubernetes or Docker Swarm
3. **Cloud Services** - AWS, GCP, Azure

## Production Checklist

Before deploying to production, ensure:

- [ ] Change default passwords in `.env`
- [ ] Set a strong `JWT_SECRET`
- [ ] Configure Google OAuth with production URLs
- [ ] Set up SSL/TLS certificates
- [ ] Configure proper CORS origins
- [ ] Set up database backups
- [ ] Configure logging and monitoring

## Docker Compose Deployment

### 1. Prepare Environment

Create a production `.env` file:

```bash
# Security
JWT_SECRET=your-strong-secret-key-min-32-characters

# Ports
BACKEND_PORT=3000
PGADMIN_PORT=5050

# Database
DB_PORT=5432
DB_HOST=letwinventory-postgres
DB_NAME=letwinventory
DB_SCHEMA=public
DB_USERNAME=letwinventory_user
DB_PASSWORD=strong-database-password
DB_DIALECT=postgres
DB_LOGGING=false

# Google OAuth
GOOGLE_CLIENT_ID=your-production-client-id
GOOGLE_CLIENT_SECRET=your-production-client-secret
GOOGLE_CALLBACK_URL=https://your-domain.com/auth/google/callback
```

### 2. Build Production Images

```bash
# Build optimized images
docker compose -f docker-compose.prod.yml build
```

### 3. Create Production Compose File

Create `docker-compose.prod.yml`:

```yaml
services:
  letwinventory-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.prod
    environment:
      NODE_ENV: production
      BACKEND_PORT: ${BACKEND_PORT}
      DB_HOST: ${DB_HOST}
      DB_NAME: ${DB_NAME}
      DB_SCHEMA: ${DB_SCHEMA}
      DB_USERNAME: ${DB_USERNAME}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_DIALECT: ${DB_DIALECT}
      DB_PORT: ${DB_PORT}
      JWT_SECRET: ${JWT_SECRET}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_CALLBACK_URL: ${GOOGLE_CALLBACK_URL}
    ports:
      - "3000:3000"
    depends_on:
      - letwinventory-postgres
    restart: unless-stopped

  letwinventory-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - letwinventory-backend
    restart: unless-stopped
    volumes:
      - ./nginx/ssl:/etc/nginx/ssl:ro

  letwinventory-postgres:
    image: postgres:13
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${DB_USERNAME}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    restart: unless-stopped
    # Don't expose port in production
    # ports:
    #   - "5432:5432"

volumes:
  postgres_data:
    driver: local
```

### 4. Create Production Dockerfiles

**Backend (`backend/Dockerfile.prod`):**

```dockerfile
FROM node:16-alpine

WORKDIR /usr/src

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
```

**Frontend (`frontend/Dockerfile.prod`):**

```dockerfile
# Build stage
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist/frontend-app/browser /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
```

### 5. Nginx Configuration

Create `nginx/nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        root /usr/share/nginx/html;
        index index.html;

        # API proxy
        location /api {
            proxy_pass http://letwinventory-backend:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Angular SPA routing
        location / {
            try_files $uri $uri/ /index.html;
        }

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

### 6. Deploy

```bash
# Start production environment
docker compose -f docker-compose.prod.yml up -d

# Run migrations
docker exec -it letwinventory-backend sequelize db:migrate

# Seed data (first deployment only)
docker exec -it letwinventory-backend sequelize db:seed:all

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

## SSL/TLS Configuration

### Using Let's Encrypt

```bash
# Install certbot
apt install certbot

# Generate certificate
certbot certonly --standalone -d your-domain.com

# Copy certificates
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ./nginx/ssl/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem ./nginx/ssl/
```

### Auto-renewal

Add to crontab:
```bash
0 0 * * * certbot renew --quiet && docker compose restart letwinventory-frontend
```

## Database Backup

### Manual Backup

```bash
docker exec letwinventory-postgres pg_dump -U postgres letwinventory > backup_$(date +%Y%m%d).sql
```

### Automated Backups

Create `scripts/backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR=/backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

docker exec letwinventory-postgres pg_dump -U postgres letwinventory | gzip > $BACKUP_DIR/backup_$TIMESTAMP.sql.gz

# Keep only last 7 days of backups
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete
```

Add to crontab for daily backups:
```bash
0 2 * * * /path/to/scripts/backup.sh
```

### Restore Backup

```bash
gunzip backup_20240101.sql.gz
docker exec -i letwinventory-postgres psql -U postgres letwinventory < backup_20240101.sql
```

## Monitoring

### Health Check Endpoint

The backend should respond to health checks:
```bash
curl http://localhost:3000/api/health
```

### Docker Health Checks

Add to docker-compose.prod.yml:

```yaml
services:
  letwinventory-backend:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Log Management

Configure centralized logging:

```yaml
services:
  letwinventory-backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Scaling

### Horizontal Scaling

For high availability, scale the backend:

```bash
docker compose -f docker-compose.prod.yml up -d --scale letwinventory-backend=3
```

Update nginx to load balance:

```nginx
upstream backend {
    server letwinventory-backend:3000;
}

location /api {
    proxy_pass http://backend;
}
```

### Database Scaling

For production workloads, consider:
- PostgreSQL read replicas
- Connection pooling with PgBouncer
- Managed database services (AWS RDS, Cloud SQL)

## Security Hardening

### Environment Variables

Never commit `.env` files. Use:
- Docker secrets
- Environment-specific config files
- Secret management services (Vault, AWS Secrets Manager)

### Network Security

- Use internal Docker networks
- Don't expose database ports
- Configure firewall rules
- Use VPN for admin access

### Application Security

- Enable CORS only for trusted origins
- Implement rate limiting
- Use helmet.js for HTTP headers
- Regular dependency updates

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs letwinventory-backend

# Check container status
docker compose ps
```

### Database Connection Issues

```bash
# Test connection from backend container
docker exec -it letwinventory-backend sh -c "nc -zv letwinventory-postgres 5432"
```

### Migration Failures

```bash
# Check migration status
docker exec -it letwinventory-backend sequelize db:migrate:status

# Reset if needed (destroys data)
docker exec -it letwinventory-backend sequelize db:migrate:undo:all
docker exec -it letwinventory-backend sequelize db:migrate
```

### Performance Issues

- Check container resource usage: `docker stats`
- Monitor database queries
- Enable Node.js profiling
- Check nginx access logs
