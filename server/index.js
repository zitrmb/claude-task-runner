import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { CONFIG } from './config.js';
import { initQueue, getQueue, addTask, updateTask } from './queue.js';
import { getRepos, addRepo, removeRepo } from './repos.js';
import { processNextTask } from './executor.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(express.json());
app.use(express.static('public'));

// WebSocket Clients speichern
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client verbunden. Aktive Clients: ${clients.size}`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client getrennt. Aktive Clients: ${clients.size}`);
  });
});

// Broadcast zu allen Clients
export function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  // Log terminal output auch in Konsole (gekürzt)
  if (type === 'terminal:output' && data.text) {
    const preview = data.text.substring(0, 100).replace(/\n/g, ' ');
    console.log(`[OUT] ${preview}${data.text.length > 100 ? '...' : ''}`);
  }
  let sent = 0;
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
      sent++;
    }
  });
  // Warnung wenn keine Clients
  if (sent === 0 && type === 'terminal:output') {
    console.log(`[WS] WARNUNG: Kein Browser verbunden! Output geht verloren.`);
  }
}

// API Routes
app.get('/api/repos', (req, res) => {
  res.json(getRepos());
});

app.post('/api/repos', (req, res) => {
  const { name, path } = req.body;
  addRepo(name, path);
  res.json({ success: true });
});

app.delete('/api/repos/:name', (req, res) => {
  removeRepo(req.params.name);
  res.json({ success: true });
});

app.get('/api/queue', (req, res) => {
  res.json(getQueue());
});

app.post('/api/tasks', (req, res) => {
  const { repo, type, description } = req.body;
  const task = addTask(repo, type, description);
  broadcast('task:added', task);
  res.json(task);
});

app.post('/api/tasks/:id/retry', (req, res) => {
  const task = updateTask(req.params.id, {
    status: 'pending',
    retries: 0
  });
  broadcast('task:updated', task);
  res.json(task);
});

// Queue initialisieren
initQueue();

// Worker-Loop starten
setInterval(() => {
  processNextTask(broadcast);
}, CONFIG.POLL_INTERVAL);

server.listen(CONFIG.PORT, () => {
  console.log(`Server läuft auf http://localhost:${CONFIG.PORT}`);
});
