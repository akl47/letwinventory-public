const express = require("express");
const http = require("http");
const app = express();
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require("path");
const dotenv = require("dotenv");
const cors = require("cors");
const { passport } = require("./auth/passport");
const printAgentService = require("./services/printAgentService");

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

// BODY PARSER - increased limit for base64 image uploads
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.text({ limit: '50mb' }));
app.use(bodyParser.json({ type: "application/vnd.api+json", limit: '50mb' }));

// Cookie parser for refresh tokens
app.use(cookieParser());

// Initialize Passport
app.use(passport.initialize());

app.use("/api", require("./api"));

// Serve Angular static files in production
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, 'public');

  // Serve static files from the Angular build
  app.use(express.static(frontendDistPath));

  // All non-API routes should serve the Angular app
  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.use(require("./util/errorHandler"));

// Create HTTP server and initialize WebSocket for print agent
const server = http.createServer(app);

// Initialize print agent WebSocket service
printAgentService.initialize(server);

server.listen(port, () => {
  db.sequelize.sync().then(() => {
    console.log(`Server listening on the port:${port}`);
  });
});
