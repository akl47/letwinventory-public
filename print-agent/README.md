# LetwinInventory Print Agent

A local print agent that bridges the hosted LetwinInventory server with Zebra label printers on your local network.

## How it Works

1. The print agent runs on a machine in your local network (where it can reach the printers)
2. It connects outbound to the hosted server via WebSocket (no firewall changes needed)
3. When someone prints from the web app, the server sends the job to the agent
4. The agent sends the ZPL to the local printer via TCP port 9100

```
[Hosted Server] <--WebSocket-- [Print Agent] --TCP:9100--> [Zebra Printer]
```

## Setup

### 1. Install Node.js

Make sure Node.js (v16 or later) is installed on the machine that will run the agent.

### 2. Install Dependencies

```bash
cd print-agent
npm install
```

### 3. Configure the Agent

Copy the example config and edit it:

```bash
cp config.json.example config.json
```

Edit `config.json` with your settings:

```json
{
  "serverUrl": "wss://letwinventory.letwin.co/ws/print-agent",
  "agentId": "warehouse-agent-1",
  "apiKey": "your-api-key-here",
  "reconnectInterval": 5000,
  "reconnectMaxDelay": 60000,
  "heartbeatInterval": 30000
}
```

| Setting | Description |
|---------|-------------|
| `serverUrl` | WebSocket URL of your LetwinInventory server |
| `agentId` | Unique identifier for this agent (any name you choose) |
| `apiKey` | API key from the server's `PRINT_AGENT_API_KEY` environment variable |
| `reconnectInterval` | Base delay (ms) before reconnecting after disconnect |
| `reconnectMaxDelay` | Maximum delay (ms) between reconnection attempts |
| `heartbeatInterval` | How often (ms) to send heartbeat to server |

### 4. Set the API Key on the Server

Add to your server's environment variables:

```bash
# .env.production
PRINT_AGENT_API_KEY=your-secret-key-here
```

Generate a secure key:
```bash
openssl rand -hex 32
```

### 5. Run the Agent

```bash
npm start
```

You should see:
```
[PrintAgent] Starting agent: warehouse-agent-1
[PrintAgent] Connecting to: wss://letwinventory.letwin.co/ws/print-agent
[PrintAgent] Connected to server
[PrintAgent] Authentication successful
```

## Running as a Service

### Linux (systemd)

Create `/etc/systemd/system/print-agent.service`:

```ini
[Unit]
Description=LetwinInventory Print Agent
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/print-agent
ExecStart=/usr/bin/node agent.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable print-agent
sudo systemctl start print-agent
```

### Windows

Use a service manager like [NSSM](https://nssm.cc/) or [PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start agent.js --name print-agent
pm2 save
pm2 startup
```

## Troubleshooting

### Agent can't connect

- Check that the server URL is correct (use `wss://` for HTTPS servers)
- Verify the server is running and accessible
- Check if a firewall is blocking outbound WebSocket connections

### Authentication failed

- Verify the API key matches `PRINT_AGENT_API_KEY` on the server
- Check that the server has the environment variable set

### Printer connection timeout

- Verify the printer is powered on and connected to the network
- Check that the printer IP is correct
- Ensure port 9100 is not blocked by a firewall
- Test connectivity: `telnet 10.50.10.91 9100`

### Jobs sent but nothing prints

- Verify the ZPL is valid for your printer model
- Check the printer's display for any error messages
- Try printing a test label directly to the printer

## Development

For development against a local server:

```json
{
  "serverUrl": "ws://localhost:3000/ws/print-agent",
  ...
}
```

Note: Use `ws://` (not `wss://`) for non-HTTPS local development.
