"use strict";

const fs = require("fs");
const path = require("path");
const Sequelize = require("sequelize");
const dotenv = require("dotenv");

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'production'
  ? '.env.production'
  : '.env.development';
dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

const basename = path.basename(__filename);
const db = {};

let sequelize = new Sequelize({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  dialect: process.env.DB_DIALECT,
  logging: false,
});

fs.readdirSync(__dirname)
  .filter((group) => {
    return group.indexOf(".") === -1;
  })
  .forEach((group) => {
    fs.readdirSync(__dirname + "/" + group)
      .filter((file) => {
        return (
          file.indexOf(".") !== 0 &&
          file !== basename &&
          file.slice(-3) === ".js"
        );
      })
      .forEach((file) => {
        const model = require(path.join(__dirname + "/" + group, file))(
          sequelize,
          Sequelize.DataTypes
        );
        db[model.name] = model;
      });
  });

Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
