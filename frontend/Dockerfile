FROM node:24-alpine

WORKDIR /usr/src/
COPY package*.json ./

# Install Angular CLI and dependencies
RUN npm install -g @angular/cli
RUN npm install

# Copy the rest of the application
COPY . .

EXPOSE 4200

CMD ["npm", "start"]