# A2 Hosting VPS Deployment Guide

This guide covers deploying LetWinInventory to an A2 Hosting VPS with Ubuntu.

## Architecture Overview

- **Single Container**: Backend serves both Angular static files and API
- **PostgreSQL**: Running on the VPS (or external)
- **Nginx**: Reverse proxy with SSL termination
- **Docker**: Container orchestration

---

## Phase 1: VPS Initial Setup

```bash
# 1. SSH into your VPS
ssh root@your-vps-ip -p 7822

# 2. Create a non-root user
adduser letwinco
usermod -aG sudo letwinco

# 3. Setup SSH key authentication (recommended)
su - letwinco
mkdir -p ~/.ssh
chmod 700 ~/.ssh
# Add your public key to ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 4. Update system
sudo apt update && sudo apt upgrade -y

# 5. Set timezone
sudo timedatectl set-timezone America/Los_Angeles
```

---

## Phase 2: Install Dependencies

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker letwinco

# Log out and back in for group changes to take effect
exit
ssh letwinco@your-vps-ip

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify installations
docker --version
docker compose version

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Install Git, certbot, and nginx
sudo apt install git certbot python3-certbot-nginx nginx -y
```

---

## Phase 3: PostgreSQL Setup

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE letwinventory;
CREATE USER letwinventory_user WITH ENCRYPTED PASSWORD 'your-strong-password-here';
GRANT ALL PRIVILEGES ON DATABASE letwinventory TO letwinventory_user;
ALTER DATABASE letwinventory OWNER TO letwinventory_user;
\c letwinventory
GRANT ALL ON SCHEMA public TO letwinventory_user;
\q

# Allow Docker containers to connect
sudo nano /etc/postgresql/*/main/pg_hba.conf
# Add this line before other entries:
# host    letwinventory    letwinventory_user    172.17.0.0/16    md5

# Allow connections on all interfaces (if needed)
sudo nano /etc/postgresql/*/main/postgresql.conf
# Change: listen_addresses = 'localhost,172.17.0.1'

# Restart PostgreSQL
sudo systemctl restart postgresql
sudo systemctl enable postgresql
```

---

## Phase 4: Clone & Configure Application

```bash
# Clone repository
cd /home/letwinco
git clone https://github.com/akl47/letwinventory.git
cd letwinventory

# Create production environment file
nano .env.production
```

### Required `.env.production` Configuration

```bash
# Security - Generate a strong secret: openssl rand -base64 32
JWT_SECRET=your-strong-32-character-secret-here

# URLs
FRONTEND_URL=https://letwinventory.letwin.co
BACKEND_PORT=3000

# Database - Use Docker host gateway to reach localhost PostgreSQL
DB_HOST=172.17.0.1
DB_NAME=letwinventory
DB_USERNAME=letwinventory_user
DB_PASSWORD=your-database-password
DB_PORT=5432
DB_DIALECT=postgres

# Google OAuth (get from Google Cloud Console)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=https://letwinventory.letwin.co/api/auth/google/callback

# Optional: pgAdmin
PGADMIN_PORT=5050
```

---

## Phase 5: DNS Configuration

Before getting SSL certificates, configure your domain DNS:

1. Log into your domain registrar (or Cloudflare, etc.)
2. Add an A record pointing to your VPS IP:
   - **Type**: A
   - **Name**: letwinventory (or @ for root domain)
   - **Value**: your-vps-ip-address
   - **TTL**: 300 (or Auto)

3. Wait for DNS propagation (can take up to 24 hours, usually faster)

```bash
# Verify DNS is working
ping letwinventory.letwin.co
```

---

## Phase 6: SSL Certificate Setup

```bash
# Stop nginx temporarily if running
sudo systemctl stop nginx

# Get SSL certificate
sudo certbot certonly --standalone -d letwinventory.letwin.co

# Verify certificate was created
sudo ls -la /etc/letsencrypt/live/letwinventory.letwin.co/
```

---

## Phase 7: Nginx Reverse Proxy Setup

```bash
# Create nginx configuration
sudo nano /etc/nginx/sites-available/letwinventory
```

### Nginx Configuration

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name letwinventory.letwin.co;
    return 301 https://$server_name$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name letwinventory.letwin.co;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/letwinventory.letwin.co/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/letwinventory.letwin.co/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Docker container
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90;
    }

    # Larger file uploads (if needed for inventory images)
    client_max_body_size 10M;
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/letwinventory /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Start nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## Phase 8: Build & Deploy Application

```bash
cd /home/letwinco/letwinventory

# Build production Docker image
docker compose -f docker-compose.prod.yml build

# Start the application
docker compose -f docker-compose.prod.yml up -d

# Check container is running
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

---

## Phase 9: Database Migration

```bash
# Run database migrations
docker exec -it letwinventory-backend-prod npx sequelize-cli db:migrate

# Check migration status
docker exec -it letwinventory-backend-prod npx sequelize-cli db:migrate:status

# (First deployment only) Seed initial data if needed
docker exec -it letwinventory-backend-prod npx sequelize-cli db:seed:all
```

---

## Phase 10: Google OAuth Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Navigate to **APIs & Services > Credentials**
4. Click on your OAuth 2.0 Client ID (or create one)
5. Under **Authorized redirect URIs**, add:
   ```
   https://letwinventory.letwin.co/api/auth/google/callback
   ```
6. Save and copy the Client ID and Secret to your `.env.production`

---

## Phase 11: Firewall Configuration

```bash
# Enable UFW firewall
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# Verify rules
sudo ufw status
```

---

## Phase 12: Automated Backups & SSL Renewal

### Create Backup Script

```bash
# Create scripts directory
mkdir -p /home/letwinco/scripts
mkdir -p /home/letwinco/backups

# Create backup script
nano /home/letwinco/scripts/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR=/home/letwinco/backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PGPASSWORD="your-database-password" pg_dump -h localhost -U letwinventory_user letwinventory | gzip > $BACKUP_DIR/backup_$TIMESTAMP.sql.gz

# Keep only last 14 days of backups
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +14 -delete

echo "Backup completed: backup_$TIMESTAMP.sql.gz"
```

```bash
# Make executable
chmod +x /home/letwinco/scripts/backup.sh

# Test the script
/home/letwinco/scripts/backup.sh
```

### Setup Cron Jobs

```bash
crontab -e
```

Add these lines:

```cron
# Daily database backup at 2 AM
0 2 * * * /home/letwinco/scripts/backup.sh >> /home/letwinco/backups/backup.log 2>&1

# SSL renewal check twice daily
0 0,12 * * * certbot renew --quiet --post-hook "systemctl reload nginx"
```

---

## Deployment Checklist

| Task | Status |
|------|--------|
| VPS SSH access configured | ☐ |
| Non-root user created (letwinco) | ☐ |
| Docker & Docker Compose installed | ☐ |
| PostgreSQL installed & configured | ☐ |
| Database and user created | ☐ |
| Repository cloned | ☐ |
| `.env.production` configured | ☐ |
| DNS A record pointing to VPS | ☐ |
| SSL certificates obtained | ☐ |
| Nginx configured & running | ☐ |
| Docker images built | ☐ |
| Containers running | ☐ |
| Database migrations complete | ☐ |
| Google OAuth callback URL added | ☐ |
| Firewall configured | ☐ |
| Backup automation configured | ☐ |
| Application accessible via HTTPS | ☐ |

---

## Useful Commands

### Container Management

```bash
# View logs (follow mode)
docker compose -f docker-compose.prod.yml logs -f

# View logs for specific service
docker compose -f docker-compose.prod.yml logs -f letwinventory-backend-prod

# Restart services
docker compose -f docker-compose.prod.yml restart

# Stop services
docker compose -f docker-compose.prod.yml down

# Start services
docker compose -f docker-compose.prod.yml up -d

# Check container status
docker compose -f docker-compose.prod.yml ps

# Shell into container
docker exec -it letwinventory-backend-prod sh
```

### Deploying Updates

```bash
cd /home/letwinco/letwinventory

# Pull latest code
git pull origin master

# Rebuild and restart
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Run any new migrations
docker exec -it letwinventory-backend-prod npx sequelize-cli db:migrate
```

### Database Operations

```bash
# Connect to database
sudo -u postgres psql letwinventory

# Manual backup
PGPASSWORD="password" pg_dump -h localhost -U letwinventory_user letwinventory > backup.sql

# Restore from backup
gunzip backup_20260123.sql.gz
PGPASSWORD="password" psql -h localhost -U letwinventory_user letwinventory < backup_20260123.sql
```

### Troubleshooting

```bash
# Check nginx status
sudo systemctl status nginx
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Check if port 3000 is listening
sudo ss -tlnp | grep 3000

# Check Docker network
docker network ls
docker network inspect letwinventory_default

# Test database connection from container
docker exec -it letwinventory-backend-prod sh -c "nc -zv 172.17.0.1 5432"
```

---

## Security Recommendations

1. **Change default passwords** - Never use example passwords in production
2. **Disable root SSH** - Use the letwinco user with sudo
3. **Keep system updated** - Run `apt update && apt upgrade` regularly
4. **Monitor logs** - Check nginx and application logs for suspicious activity
5. **Backup regularly** - Verify backups can be restored
6. **Use strong JWT secret** - Generate with `openssl rand -base64 32`

---

## A2 Hosting Specific Notes

- A2 Hosting VPS typically comes with Ubuntu pre-installed
- You may need to enable certain ports through their control panel
- Check if Docker is pre-installed or needs manual installation
- Consider their managed VPS option if you need support with server maintenance
