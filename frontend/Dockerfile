FROM node:24-alpine

WORKDIR /app

# Install Angular CLI globally
RUN npm install -g @angular/cli

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 4200

# Poll for changes is often needed in Docker on Windows
CMD ["ng", "serve", "--host", "0.0.0.0", "--poll", "2000"]
