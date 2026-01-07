const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const path = require("path");
const dotenv = require("dotenv");
const cors = require("cors");
const { passport } = require("./auth/passport");

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'production'
  ? '.env.production'
  : '.env.development';
dotenv.config({ path: path.join(__dirname, `../${envFile}`) });

const port = process.env.BACKEND_PORT;
global.db = require("./models");
global.RestError = require("./util/RestError");
global._ = require("lodash");

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

app.use((req, res, next) => {
  console.log("Request URL:", req.method, req.url);
  next();
});

// BODY PARSER
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text());
app.use(bodyParser.json({ type: "application/vnd.api+json" }));

// Initialize Passport
app.use(passport.initialize());

app.use("/api", require("./api"));

// Serve Angular static files in production
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, 'public');

  // Serve static files from the Angular build
  app.use(express.static(frontendDistPath));

  // All non-API routes should serve the Angular app
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.use(require("./util/errorHandler"));

app.listen(port, () => {
  db.sequelize.sync().then(() => {
    console.log(`Server listening on the port:${port}`);
  });
});
