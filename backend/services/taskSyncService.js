// SSE client registry for real-time task sync
// Maintains connected clients per user and broadcasts "tasks-changed" events

const clients = new Map(); // Map<userId, Set<{res, tabId}>>

function addClient(userId, res, tabId) {
    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    const client = { res, tabId };
    clients.get(userId).add(client);

    res.on('close', () => {
        const userClients = clients.get(userId);
        if (userClients) {
            userClients.delete(client);
            if (userClients.size === 0) {
                clients.delete(userId);
            }
        }
    });
}

function broadcast(sourceTabId) {
    let sent = 0;
    let skipped = 0;
    for (const userClients of clients.values()) {
        for (const client of userClients) {
            if (client.tabId !== sourceTabId) {
                client.res.write(`event: tasks-changed\ndata: ${JSON.stringify({ sourceTabId })}\n\n`);
                sent++;
            } else {
                skipped++;
            }
        }
    }
}

module.exports = { addClient, broadcast };
