'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

class PrintAgentService {
  constructor() {
    this.wss = null;
    this.connectedAgents = new Map(); // agentId -> { ws, lastHeartbeat, authenticated }
    this.pendingJobs = new Map();     // jobId -> { resolve, reject, timeout }
    this.heartbeatInterval = null;
  }

  /**
   * Initialize the WebSocket server
   * @param {http.Server} server - HTTP server instance
   */
  initialize(server) {
    this.wss = new WebSocket.Server({
      server,
      path: '/ws/print-agent'
    });

    this.wss.on('connection', (ws, req) => {
      console.log('[PrintAgent] New connection from:', req.socket.remoteAddress);
      this.handleConnection(ws, req);
    });

    // Start heartbeat checker
    this.heartbeatInterval = setInterval(() => {
      this.checkHeartbeats();
    }, 60000); // Check every minute

    console.log('[PrintAgent] WebSocket server initialized on /ws/print-agent');
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, req) {
    // Set up authentication timeout
    const authTimeout = setTimeout(() => {
      if (!ws.authenticated) {
        console.log('[PrintAgent] Connection closed - authentication timeout');
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000); // 10 second timeout for auth

    ws.authenticated = false;
    ws.agentId = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(ws, message, authTimeout);
      } catch (error) {
        console.error('[PrintAgent] Invalid message format:', error.message);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (ws.agentId) {
        console.log(`[PrintAgent] Agent disconnected: ${ws.agentId}`);
        this.connectedAgents.delete(ws.agentId);
      }
    });

    ws.on('error', (error) => {
      console.error('[PrintAgent] WebSocket error:', error.message);
    });
  }

  /**
   * Handle incoming messages from agents
   */
  handleMessage(ws, message, authTimeout) {
    switch (message.type) {
      case 'auth':
        this.handleAuth(ws, message, authTimeout);
        break;

      case 'heartbeat':
        this.handleHeartbeat(ws, message);
        break;

      case 'job_result':
        this.handleJobResult(ws, message);
        break;

      default:
        console.log('[PrintAgent] Unknown message type:', message.type);
    }
  }

  /**
   * Handle authentication request
   */
  handleAuth(ws, message, authTimeout) {
    const { agentId, apiKey } = message;
    const expectedApiKey = process.env.PRINT_AGENT_API_KEY;

    if (!expectedApiKey) {
      console.error('[PrintAgent] PRINT_AGENT_API_KEY not configured');
      ws.send(JSON.stringify({
        type: 'auth_result',
        success: false,
        message: 'Server not configured for print agents'
      }));
      ws.close(4003, 'Server not configured');
      return;
    }

    if (apiKey === expectedApiKey) {
      clearTimeout(authTimeout);
      ws.authenticated = true;
      ws.agentId = agentId;

      // Store agent connection
      this.connectedAgents.set(agentId, {
        ws,
        lastHeartbeat: Date.now(),
        authenticated: true
      });

      ws.send(JSON.stringify({
        type: 'auth_result',
        success: true,
        message: 'Authenticated successfully'
      }));

      console.log(`[PrintAgent] Agent authenticated: ${agentId}`);
    } else {
      console.log(`[PrintAgent] Authentication failed for agent: ${agentId}`);
      ws.send(JSON.stringify({
        type: 'auth_result',
        success: false,
        message: 'Invalid API key'
      }));
      ws.close(4002, 'Authentication failed');
    }
  }

  /**
   * Handle heartbeat from agent
   */
  handleHeartbeat(ws, message) {
    if (!ws.authenticated || !ws.agentId) {
      return;
    }

    const agent = this.connectedAgents.get(ws.agentId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
    }

    ws.send(JSON.stringify({
      type: 'heartbeat_ack',
      timestamp: Date.now()
    }));
  }

  /**
   * Handle job result from agent
   */
  handleJobResult(ws, message) {
    const { jobId, status, error } = message;
    const pendingJob = this.pendingJobs.get(jobId);

    if (pendingJob) {
      clearTimeout(pendingJob.timeout);
      this.pendingJobs.delete(jobId);

      if (status === 'completed') {
        pendingJob.resolve({ success: true });
      } else {
        pendingJob.reject(new Error(error || 'Print job failed'));
      }
    }
  }

  /**
   * Check for stale connections
   */
  checkHeartbeats() {
    const now = Date.now();
    const staleThreshold = 2 * 60 * 1000; // 2 minutes

    for (const [agentId, agent] of this.connectedAgents) {
      if (now - agent.lastHeartbeat > staleThreshold) {
        console.log(`[PrintAgent] Agent ${agentId} appears stale, closing connection`);
        agent.ws.close(4004, 'Heartbeat timeout');
        this.connectedAgents.delete(agentId);
      }
    }
  }

  /**
   * Send a print job to a connected agent
   * @param {string} zpl - ZPL code to print
   * @param {string} printerIp - Target printer IP
   * @returns {Promise} Resolves when print completes
   */
  sendPrintJob(zpl, printerIp) {
    return new Promise((resolve, reject) => {
      // Find a connected agent
      const agent = this.getConnectedAgent();

      if (!agent) {
        return reject(new Error('No print agent connected'));
      }

      const jobId = crypto.randomUUID();

      // Set up job timeout (30 seconds)
      const timeout = setTimeout(() => {
        this.pendingJobs.delete(jobId);
        reject(new Error('Print job timed out'));
      }, 30000);

      // Store pending job
      this.pendingJobs.set(jobId, { resolve, reject, timeout });

      // Send job to agent
      const jobMessage = {
        type: 'print_job',
        jobId,
        zpl,
        printerIp
      };

      agent.ws.send(JSON.stringify(jobMessage));
      console.log(`[PrintAgent] Sent job ${jobId} to agent ${agent.ws.agentId}`);
    });
  }

  /**
   * Get a connected agent (returns first available)
   */
  getConnectedAgent() {
    for (const [agentId, agent] of this.connectedAgents) {
      if (agent.authenticated && agent.ws.readyState === WebSocket.OPEN) {
        return agent;
      }
    }
    return null;
  }

  /**
   * Check if any print agent is connected
   */
  hasConnectedAgent() {
    return this.getConnectedAgent() !== null;
  }

  /**
   * Get status of all connected agents
   */
  getAgentStatus() {
    const agents = [];
    for (const [agentId, agent] of this.connectedAgents) {
      agents.push({
        agentId,
        connected: agent.ws.readyState === WebSocket.OPEN,
        lastHeartbeat: agent.lastHeartbeat
      });
    }
    return agents;
  }

  /**
   * Shutdown the service
   */
  shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Clear pending jobs
    for (const [jobId, job] of this.pendingJobs) {
      clearTimeout(job.timeout);
      job.reject(new Error('Service shutting down'));
    }
    this.pendingJobs.clear();

    // Close all connections
    for (const [agentId, agent] of this.connectedAgents) {
      agent.ws.close(1001, 'Server shutting down');
    }
    this.connectedAgents.clear();

    if (this.wss) {
      this.wss.close();
    }
  }
}

// Export singleton instance
module.exports = new PrintAgentService();
