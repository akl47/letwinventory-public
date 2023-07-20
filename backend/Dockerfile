FROM node:18

# Create app directory
RUN mkdir -p /usr/src
WORKDIR /usr/src

# Install dependencies
COPY ./package.json .
RUN npm install

RUN npm i -g sequelize-cli

# Bundle app source
COPY . .

RUN npm i -s brcypt



# Exports
EXPOSE 3000
CMD [ "npm", "start" ]

