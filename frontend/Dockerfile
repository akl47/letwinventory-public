FROM node:24-alpine

WORKDIR /app

# Install Angular CLI globally
RUN npm install -g @angular/cli

# We expect the host to mount the volume with package.json after generation
# But for the initial build context, we might not have it yet. 
# This is a dev container, so we'll rely on the volume mount.

EXPOSE 4200

# Poll for changes is often needed in Docker on Windows
CMD ["ng", "serve", "--host", "0.0.0.0", "--poll", "2000"]