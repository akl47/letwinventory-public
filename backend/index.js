const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const fs = require("fs");
const https = require("https");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../.env") });

const port = process.env.BACKEND_PORT;
const cors = require("cors");
global.db = require("./models");
global.RestError = require("./util/RestError");
global._ = require("lodash");

app.use(cors());

app.use((req, res, next) => {
  console.log(req.url);
  next();
});

// BODY PARSER
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text());
app.use(bodyParser.json({ type: "application/vnd.api+json" }));

// HEADERS

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin,X-Requested-With,Content-Type,Accept,Authorization"
  );
  next();
});

// app.use((error, req, res, next) => {
//   console.log("Handling Error")
//   res.status(error.status || 500)
//   res.json({ message: error.message })
// })

app.use("/api", require("./api"));

app.use(require("./util/errorHandler"));

app.listen(port, () => {
  db.sequelize.sync().then(() => {
    console.log(`Server listening on the port:${port}`);
  });
});
