
FROM node:18

WORKDIR /usr/src/
COPY package*.json ./

RUN npm install -g @angular/cli @angular-devkit/build-angular && npm install --legacy-peer-deps

EXPOSE 4200

CMD ["npm", "start"]