const express = require("express");
const http = require("http");
const app = express();
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require("path");
const dotenv = require("dotenv");
const cors = require("cors");

// Load environment-specific .env file BEFORE requiring modules that need env vars
if (process.env.NODE_ENV !== 'test') {
    const envFile = process.env.NODE_ENV === 'production'
        ? '.env.production'
        : '.env.development';
    dotenv.config({ path: path.join(__dirname, `../${envFile}`) });
}

const { passport } = require("./auth/passport");

if (!global.db) {
    global.db = require("./models");
}
global.RestError = require("./util/RestError");
global._ = require("lodash");

// CORS configuration
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Tab-Id']
}));

if (process.env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
        console.log("Request URL:", req.method, req.url);
        next();
    });
}

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

// Export app for testing
module.exports = app;

// Only start server when run directly (not when imported for testing)
if (require.main === module) {
    const printAgentService = require("./services/printAgentService");
    const scheduledTaskService = require("./services/scheduledTaskService");
    const notificationService = require("./services/notificationService");
    const cadStreamService = require("./services/cadStreamService");
    const cadKernelSupervisor = require("./services/cadKernelSupervisor");
    const port = process.env.BACKEND_PORT;

    const server = http.createServer(app);
    printAgentService.initialize(server);
    // REQ 700 (Phase 1) — CAD WebSocket session manager for regenerate
    // progress events and (Phase 1.5) incremental mesh deltas. The Rust
    // kernel sidecar on TCP (default 127.0.0.1:9876; override with
    // CAD_KERNEL_ADDR) is consumed by cadKernelClient on-demand — no eager
    // handshake here.
    cadStreamService.initialize(server);
    // Opt-in: when CAD_KERNEL_AUTOSPAWN=1 the supervisor owns the kernel's
    // lifecycle (spawn + log piping + crash-restart). Defaults off so the
    // current `cargo run` dev workflow keeps working.
    cadKernelSupervisor.initialize();

    server.listen(port, () => {
        // Migrations are the sole source of truth for schema. We previously
        // called `sequelize.sync()` here, which races the migration system —
        // sync() auto-creates tables (and named indexes) from any model that
        // doesn't have a corresponding table yet, leaving `SequelizeMeta`
        // with no record. The next `db:migrate` run then collides on the
        // already-existing relations. New models MUST ship with a paired
        // migration; the backend will fail loudly at first query against an
        // unmigrated table, which is the correct behaviour.
        console.log(`Server listening on the port:${port}`);
        scheduledTaskService.initialize();
        notificationService.initialize();
        // Background eviction of stale DesignBRepCache rows. Hourly sweep,
        // 14-day TTL by default — override via CAD_BREP_CACHE_TTL_DAYS.
        require('./services/cadCacheEvictionService').initialize();
        // Garbage collection of unreachable VCS objects (REQ 902). Daily
        // sweep, 7-day grace by default — override via VCS_GC_GRACE_DAYS.
        require('./services/vcs/vcsGcService').initialize();
        // Clear expired CLEAN checkout locks so stale attributions don't
        // linger until the next checkout attempt (dirty expired locks keep
        // their holder for the takeover+stash flow, REQ 874).
        setInterval(() => {
            require('./services/vcs/cadVcsService').sweepExpiredLocks()
                .catch((err) => console.error('[CadLockSweep] failed:', err));
        }, 10 * 60 * 1000);
    });
}
