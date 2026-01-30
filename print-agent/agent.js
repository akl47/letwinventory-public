#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');
const Net = require('net');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Error loading config.json:', error.message);
  console.error('Please copy config.json.example to config.json and update the values.');
  process.exit(1);
}

// Validate required config
const requiredFields = ['serverUrl', 'agentId', 'apiKey'];
for (const field of requiredFields) {
  if (!config[field]) {
    console.error(`Missing required config field: ${field}`);
    process.exit(1);
  }
}

// Configuration with defaults
const SERVER_URL = config.serverUrl;
const AGENT_ID = config.agentId;
const API_KEY = config.apiKey;
const RECONNECT_BASE_DELAY = config.reconnectInterval || 5000;
const RECONNECT_MAX_DELAY = config.reconnectMaxDelay || 60000;
const HEARTBEAT_INTERVAL = config.heartbeatInterval || 30000;

class PrintAgent {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.isAuthenticated = false;
    this.isShuttingDown = false;
  }

  /**
   * Start the print agent
   */
  start() {
    console.log(`[PrintAgent] Starting agent: ${AGENT_ID}`);
    console.log(`[PrintAgent] Connecting to: ${SERVER_URL}`);
    this.connect();

    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Connect to the server
   */
  connect() {
    if (this.isShuttingDown) return;

    try {
      this.ws = new WebSocket(SERVER_URL);

      this.ws.on('open', () => {
        console.log('[PrintAgent] Connected to server');
        this.reconnectAttempts = 0;
        this.authenticate();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[PrintAgent] Connection closed: ${code} - ${reason || 'No reason'}`);
        this.cleanup();
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[PrintAgent] WebSocket error:', error.message);
      });
    } catch (error) {
      console.error('[PrintAgent] Connection error:', error.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Send authentication message
   */
  authenticate() {
    console.log(`[PrintAgent] Sending authentication for agent: ${AGENT_ID}`);
    console.log(`[PrintAgent] API key (first 8 chars): ${API_KEY.substring(0, 8)}...`);
    this.send({
      type: 'auth',
      agentId: AGENT_ID,
      apiKey: API_KEY
    });
  }

  /**
   * Handle incoming messages
   */
  handleMessage(data) {
    try {
      const rawData = data.toString();
      console.log('[PrintAgent] Raw message received:', rawData.substring(0, 200) + (rawData.length > 200 ? '...' : ''));

      const message = JSON.parse(rawData);
      console.log('[PrintAgent] Parsed message type:', message.type);

      switch (message.type) {
        case 'auth_result':
          this.handleAuthResult(message);
          break;

        case 'print_job':
          console.log('[PrintAgent] === PRINT JOB RECEIVED ===');
          this.handlePrintJob(message);
          break;

        case 'heartbeat_ack':
          // Heartbeat acknowledged (silent)
          break;

        case 'ping':
          console.log('[PrintAgent] Ping received, sending pong');
          this.send({ type: 'pong' });
          break;

        default:
          console.log('[PrintAgent] Unknown message type:', message.type);
          console.log('[PrintAgent] Full message:', JSON.stringify(message, null, 2));
      }
    } catch (error) {
      console.error('[PrintAgent] Error parsing message:', error.message);
      console.error('[PrintAgent] Raw data was:', data.toString().substring(0, 500));
    }
  }

  /**
   * Handle authentication result
   */
  handleAuthResult(message) {
    if (message.success) {
      console.log('[PrintAgent] Authentication successful');
      this.isAuthenticated = true;
      this.startHeartbeat();
    } else {
      console.error('[PrintAgent] Authentication failed:', message.message);
      this.isAuthenticated = false;
      // Don't reconnect on auth failure - it will keep failing
      if (message.message === 'Invalid API key') {
        console.error('[PrintAgent] Please check your API key in config.json');
        this.isShuttingDown = true;
        this.ws.close();
      }
    }
  }

  /**
   * Handle print job
   */
  async handlePrintJob(message) {
    const { jobId, zpl, printerIp } = message;
    console.log(`[PrintAgent] === PROCESSING PRINT JOB ===`);
    console.log(`[PrintAgent] Job ID: ${jobId}`);
    console.log(`[PrintAgent] Printer IP: ${printerIp}`);
    console.log(`[PrintAgent] ZPL length: ${zpl ? zpl.length : 0} characters`);
    console.log(`[PrintAgent] ZPL preview: ${zpl ? zpl.substring(0, 100) : 'NO ZPL'}...`);

    if (!zpl) {
      console.error(`[PrintAgent] Job ${jobId} has no ZPL data!`);
      this.send({
        type: 'job_result',
        jobId,
        status: 'failed',
        error: 'No ZPL data received'
      });
      return;
    }

    if (!printerIp) {
      console.error(`[PrintAgent] Job ${jobId} has no printer IP!`);
      this.send({
        type: 'job_result',
        jobId,
        status: 'failed',
        error: 'No printer IP specified'
      });
      return;
    }

    try {
      console.log(`[PrintAgent] Attempting to send to printer ${printerIp}:9100...`);
      await this.sendToPrinter(zpl, printerIp);
      console.log(`[PrintAgent] Job ${jobId} completed successfully`);
      this.send({
        type: 'job_result',
        jobId,
        status: 'completed'
      });
    } catch (error) {
      console.error(`[PrintAgent] Job ${jobId} failed:`, error.message);

      // Retry once
      try {
        console.log(`[PrintAgent] Retrying job ${jobId} in 1 second...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.sendToPrinter(zpl, printerIp);
        console.log(`[PrintAgent] Job ${jobId} completed on retry`);
        this.send({
          type: 'job_result',
          jobId,
          status: 'completed'
        });
      } catch (retryError) {
        console.error(`[PrintAgent] Job ${jobId} failed on retry:`, retryError.message);
        this.send({
          type: 'job_result',
          jobId,
          status: 'failed',
          error: retryError.message
        });
      }
    }
  }

  /**
   * Send ZPL to printer via TCP
   */
  sendToPrinter(zpl, printerIp) {
    return new Promise((resolve, reject) => {
      console.log(`[PrintAgent] Creating TCP socket to ${printerIp}:9100`);
      const client = new Net.Socket();
      let isResolved = false;

      // Set timeout
      client.setTimeout(10000);
      console.log(`[PrintAgent] Socket timeout set to 10000ms`);

      client.on('error', (error) => {
        console.error(`[PrintAgent] Socket error: ${error.message}`);
        console.error(`[PrintAgent] Error code: ${error.code}`);
        if (!isResolved) {
          isResolved = true;
          client.destroy();
          reject(new Error(`Printer connection error: ${error.message}`));
        }
      });

      client.on('timeout', () => {
        console.error(`[PrintAgent] Socket timeout - no response from printer`);
        if (!isResolved) {
          isResolved = true;
          client.destroy();
          reject(new Error('Printer connection timeout'));
        }
      });

      client.on('close', (hadError) => {
        console.log(`[PrintAgent] Socket closed, hadError: ${hadError}`);
      });

      console.log(`[PrintAgent] Initiating connection to ${printerIp}:9100...`);
      client.connect({ port: 9100, host: printerIp }, () => {
        console.log(`[PrintAgent] Connected to printer ${printerIp}:9100`);
        console.log(`[PrintAgent] Writing ${zpl.length} bytes of ZPL data...`);
        client.write(zpl, () => {
          console.log(`[PrintAgent] ZPL data written successfully`);
          if (!isResolved) {
            isResolved = true;
            client.destroy();
            resolve();
          }
        });
      });
    });
  }

  /**
   * Start heartbeat timer
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isAuthenticated && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({
          type: 'heartbeat',
          timestamp: Date.now()
        });
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.isShuttingDown || this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );
    this.reconnectAttempts++;

    console.log(`[PrintAgent] Reconnecting in ${delay / 1000} seconds...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Send message to server
   */
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msgStr = JSON.stringify(message);
      // Don't log heartbeats to reduce noise
      if (message.type !== 'heartbeat') {
        console.log(`[PrintAgent] Sending message: ${message.type}`);
        if (message.type === 'job_result') {
          console.log(`[PrintAgent] Job result: ${message.status}${message.error ? ' - ' + message.error : ''}`);
        }
      }
      this.ws.send(msgStr);
    } else {
      console.error(`[PrintAgent] Cannot send message - WebSocket not open (state: ${this.ws ? this.ws.readyState : 'null'})`);
    }
  }

  /**
   * Cleanup on disconnect
   */
  cleanup() {
    this.isAuthenticated = false;
    this.stopHeartbeat();
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    console.log('[PrintAgent] Shutting down...');
    this.isShuttingDown = true;

    this.cleanup();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
    }

    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }
}

// Start the agent
const agent = new PrintAgent();
agent.start();
