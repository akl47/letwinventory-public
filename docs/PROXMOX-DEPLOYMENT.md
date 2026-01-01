# Proxmox Deployment Guide

This guide walks through deploying LetWinInventory on a Proxmox server as a production-like environment.

## Overview

We'll create an LXC container (lightweight) or VM running Ubuntu, install Docker, and deploy the application with proper networking and SSL.

## Prerequisites

- Proxmox VE 7.x or 8.x installed
- Access to Proxmox web interface
- A domain name (optional, for SSL)
- Basic familiarity with Linux command line

LXC containers are lighter weight and start faster than VMs.

### Step 1: Download Ubuntu Template

1. Log into Proxmox web interface
2. Select your storage (e.g., `local`)
3. Click **CT Templates**
4. Click **Templates** button
5. Download `ubuntu-22.04-standard` (or newer)

### Step 2: Create the Container

1. Click **Create CT** in the top right
2. Configure the container:

| Setting | Value |
|---------|-------|
| Hostname | `letwinventory` |
| Password | Set a strong root password |
| Template | `ubuntu-22.04-standard` |
| Disk | 20GB minimum |
| CPU | 2 cores |
| Memory | 2048 MB |
| Swap | 512 MB |
| Network | DHCP or static IP |

3. Under **Options**, check:
   - [x] Start at boot
   - [x] Nesting (required for Docker)

4. Click **Create**

### Step 3: Enable Docker Support

Before starting the container, enable features needed for Docker:

```bash
# On Proxmox host, edit the container config
nano /etc/pve/lxc/<CTID>.conf
```

Add these lines:

```
features: nesting=1
lxc.apparmor.profile: unconfined
lxc.cap.drop:
lxc.cgroup2.devices.allow: a
lxc.mount.auto: proc:rw sys:rw
```

### Step 4: Start and Access Container

1. Start the container from Proxmox UI
2. Open the console or SSH in:

```bash
ssh root@<container-ip>
```

---

### Step 5: Update System

```bash
apt update && apt upgrade -y
```

### Step 6: Install Docker

```bash
# Install prerequisites
apt install -y ca-certificates curl gnupg lsb-release

# Add Docker GPG key
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

### Step 7: Install Additional Tools

```bash
apt install -y git nano htop
```

### Step 8: Clone the Repository

```bash
cd /opt
git clone <your-repo-url> letwinventory
cd letwinventory
```

### Step 9: Configure Environment

```bash
# Copy example configs
cp .env.example .env
cp backend/config/config.json.example backend/config/config.json

# Edit environment variables
nano .env
```

Update `.env` for production:

```bash
# Security - CHANGE THESE!
JWT_SECRET=your-very-long-random-secret-key-min-32-chars

# Ports
BACKEND_PORT=3000
PGADMIN_PORT=5050

# Database
DB_PORT=5432
DB_HOST=letwinventory-postgres
DB_NAME=letwinventory
DB_SCHEMA=public
DB_USERNAME=letwinventory_user
DB_PASSWORD=strong-database-password-here
DB_DIALECT=postgres
DB_LOGGING=false

# Google OAuth (configure in Google Cloud Console)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=https://your-domain.com/api/auth/google/callback
```

### Step 10: Create Production Docker Compose

Create `docker-compose.prod.yml`:

```bash
nano docker-compose.prod.yml
```

```yaml
services:
  letwinventory-backend:
    build:
      context: ./backend
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
      - "127.0.0.1:3000:3000"
    depends_on:
      - letwinventory-postgres
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  letwinventory-frontend:
    build:
      context: ./frontend
    ports:
      - "127.0.0.1:4200:4200"
    depends_on:
      - letwinventory-backend
    restart: unless-stopped

  letwinventory-postgres:
    image: postgres:13
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${DB_USERNAME}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    restart: unless-stopped
    # Don't expose database port externally

volumes:
  postgres_data:
    driver: local
```

### Step 11: Build and Start Services

```bash
# Build images
docker compose -f docker-compose.prod.yml build

# Start services
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps
```

### Step 12: Initialize Database

```bash
# Run migrations
docker exec -it letwinventory-backend sh -c "npx sequelize db:migrate"

# Seed initial data
docker exec -it letwinventory-backend sh -c "npx sequelize db:seed:all"
```

---

## Nginx Reverse Proxy with SSL

### Step 13: Install Nginx

```bash
apt install -y nginx
```

### Step 14: Install Certbot for SSL

```bash
apt install -y certbot python3-certbot-nginx
```

### Step 15: Configure Nginx

```bash
nano /etc/nginx/sites-available/letwinventory
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:

```bash
ln -s /etc/nginx/sites-available/letwinventory /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### Step 16: Obtain SSL Certificate

```bash
certbot --nginx -d your-domain.com
```

Follow the prompts. Certbot will automatically configure HTTPS.

### Step 17: Auto-Renewal

Certbot sets up auto-renewal automatically. Verify with:

```bash
certbot renew --dry-run
```

---

## Firewall Configuration

### Step 18: Configure UFW

```bash
# Install UFW
apt install -y ufw

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow 22/tcp

# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw enable

# Check status
ufw status
```

---

## Backup Configuration

### Step 19: Database Backup Script

Create `/opt/letwinventory/scripts/backup.sh`:

```bash
mkdir -p /opt/letwinventory/scripts
nano /opt/letwinventory/scripts/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/opt/letwinventory/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker exec letwinventory-postgres pg_dump -U letwinventory_user letwinventory | gzip > $BACKUP_DIR/db_backup_$TIMESTAMP.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "db_backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/db_backup_$TIMESTAMP.sql.gz"
```

Make executable and schedule:

```bash
chmod +x /opt/letwinventory/scripts/backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
```

Add this line:

```
0 2 * * * /opt/letwinventory/scripts/backup.sh >> /var/log/letwinventory-backup.log 2>&1
```

### Step 20: Proxmox Backup

In Proxmox UI:
1. Go to **Datacenter** → **Backup**
2. Click **Add**
3. Configure:
   - Storage: Your backup storage
   - Schedule: Weekly
   - Selection Mode: Include selected VMs
   - Select your letwinventory container/VM
4. Click **Create**

---

## Monitoring

### Step 21: Basic Monitoring Script

Create `/opt/letwinventory/scripts/health-check.sh`:

```bash
nano /opt/letwinventory/scripts/health-check.sh
```

```bash
#!/bin/bash

# Check if containers are running
if ! docker ps | grep -q letwinventory-backend; then
    echo "Backend container is down! Restarting..."
    cd /opt/letwinventory && docker compose -f docker-compose.prod.yml up -d
fi

if ! docker ps | grep -q letwinventory-frontend; then
    echo "Frontend container is down! Restarting..."
    cd /opt/letwinventory && docker compose -f docker-compose.prod.yml up -d
fi

if ! docker ps | grep -q letwinventory-postgres; then
    echo "Database container is down! Restarting..."
    cd /opt/letwinventory && docker compose -f docker-compose.prod.yml up -d
fi
```

Schedule every 5 minutes:

```bash
chmod +x /opt/letwinventory/scripts/health-check.sh
crontab -e
```

Add:

```
*/5 * * * * /opt/letwinventory/scripts/health-check.sh >> /var/log/letwinventory-health.log 2>&1
```

---

## Maintenance Commands

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f letwinventory-backend
```

### Restart Services

```bash
docker compose -f docker-compose.prod.yml restart
```

### Update Application

```bash
cd /opt/letwinventory

# Pull latest code
git pull

# Rebuild and restart
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Run any new migrations
docker exec -it letwinventory-backend sh -c "npx sequelize db:migrate"
```

### Restore Database

```bash
# Stop services
docker compose -f docker-compose.prod.yml stop letwinventory-backend letwinventory-frontend

# Restore
gunzip < /opt/letwinventory/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz | docker exec -i letwinventory-postgres psql -U letwinventory_user letwinventory

# Restart
docker compose -f docker-compose.prod.yml up -d
```

---

## Network Diagram

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────┐
│              Proxmox Host                       │
│  ┌───────────────────────────────────────────┐  │
│  │     LXC Container / VM                    │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │           Nginx (443/80)            │  │  │
│  │  └──────────────┬──────────────────────┘  │  │
│  │                 │                         │  │
│  │       ┌─────────┴─────────┐               │  │
│  │       ▼                   ▼               │  │
│  │  ┌─────────┐        ┌─────────┐           │  │
│  │  │Frontend │        │ Backend │           │  │
│  │  │ :4200   │        │ :3000   │           │  │
│  │  └─────────┘        └────┬────┘           │  │
│  │                          │                │  │
│  │                     ┌────▼────┐           │  │
│  │                     │PostgreSQL│          │  │
│  │                     │  :5432   │          │  │
│  │                     └──────────┘          │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Troubleshooting

### Container Won't Start Docker

If Docker fails in LXC container:

```bash
# On Proxmox host
pct set <CTID> --features nesting=1
pct set <CTID> --unprivileged 0
```

### Permission Denied Errors

```bash
# Fix Docker socket permissions
chmod 666 /var/run/docker.sock
```

### Database Connection Failed

```bash
# Check if postgres is running
docker ps | grep postgres

# Check logs
docker logs letwinventory-postgres
```

### Out of Disk Space

```bash
# Clean Docker resources
docker system prune -a

# Check disk usage
df -h
```

---

## Security Checklist

- [ ] Changed default database password
- [ ] Set strong JWT_SECRET (32+ characters)
- [ ] Configured SSL/HTTPS
- [ ] Enabled firewall (UFW)
- [ ] Disabled pgAdmin in production (or secured it)
- [ ] Set up automated backups
- [ ] Configured Google OAuth with production URLs
- [ ] Enabled Proxmox backup for the container/VM
