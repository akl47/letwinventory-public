Requires:
Docker v20.10.11
Docker Compose v2.2.1
Node 16
Npm 8

Steps for setting up:

1. Clone the repo
1. ```cd frontend```
1. ```npn install```
1. ```cd ../backend```
1. ```npm install```
1. ```cd ..```
1. ```cp backend/config/config.json.example backend/config.json```
1. ```cp .env.example .env```
1.  ```sudo docker compose up```
1. go to http://localhost:5050
    1. Username: admin@admin.com
    1. Password: root
    1. Add Server
        1. Login using information in .env
    1. Create letwinventory database
1. In a seperate terminal 
    1. ```docker exec -it letwinventory-backend /bin/bash```
    1. `sequelize db:migrate`
    1. `sequelize db:seed:all`

1. Done!

Your website should now be running localy at http://localhost:4200
