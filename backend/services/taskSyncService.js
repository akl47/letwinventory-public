// SSE client registry for real-time task sync
// Maintains connected clients per user and broadcasts "tasks-changed" events

const clients = new Map(); // Map<userId, Set<{res, tabId}>>

function addClient(userId, res, tabId) {
    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    const client = { res, tabId };
    clients.get(userId).add(client);

    const totalClients = Array.from(clients.values()).reduce((sum, s) => sum + s.size, 0);
    console.log(`[SSE] Client connected: userId=${userId}, tabId=${tabId}, totalClients=${totalClients}`);

    res.on('close', () => {
        const userClients = clients.get(userId);
        if (userClients) {
            userClients.delete(client);
            if (userClients.size === 0) {
                clients.delete(userId);
            }
        }
        const remaining = Array.from(clients.values()).reduce((sum, s) => sum + s.size, 0);
        console.log(`[SSE] Client disconnected: userId=${userId}, tabId=${tabId}, remainingClients=${remaining}`);
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
    console.log(`[SSE] Broadcast: sourceTabId=${sourceTabId}, sent=${sent}, skipped=${skipped}`);
}

module.exports = { addClient, broadcast };
