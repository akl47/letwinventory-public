FROM node:18

# Create app directory
RUN mkdir -p /usr/src
WORKDIR /usr/src

# Install dependencies
COPY ./package.json .
RUN npm install

# Install bcrypt with proper build flags
RUN npm install bcrypt

RUN npm i -g sequelize-cli

# Bundle app source
COPY . .

# Exports
EXPOSE 3000
CMD [ "npm", "start" ]

