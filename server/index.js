import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { existsSync, statSync } from 'fs';
import { resolve, normalize } from 'path';
import { CONFIG } from './config.js';
import { initQueue, getQueue, addTask, updateTask } from './queue.js';
import { getRepos, addRepo, removeRepo } from './repos.js';
import { processNextTask, abortCurrentTask } from './executor.js';

// Input-Validierung
const MAX_NAME_LENGTH = 100;
const MAX_PATH_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 2000;
const VALID_TASK_TYPES = ['feature', 'bugfix', 'refactor'];

function validatePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, error: 'Pfad erforderlich' };
  }
  if (inputPath.length > MAX_PATH_LENGTH) {
    return { valid: false, error: 'Pfad zu lang' };
  }

  // Normalisiere und prüfe auf Path Traversal
  const normalized = normalize(inputPath);
  if (normalized.includes('..')) {
    return { valid: false, error: 'Path Traversal nicht erlaubt' };
  }

  // Prüfe ob absoluter Pfad
  if (!inputPath.startsWith('/')) {
    return { valid: false, error: 'Nur absolute Pfade erlaubt' };
  }

  // Prüfe ob Verzeichnis existiert
  try {
    if (!existsSync(inputPath)) {
      return { valid: false, error: 'Verzeichnis existiert nicht' };
    }
    const stat = statSync(inputPath);
    if (!stat.isDirectory()) {
      return { valid: false, error: 'Pfad ist kein Verzeichnis' };
    }
  } catch (e) {
    return { valid: false, error: 'Pfad nicht zugreifbar' };
  }

  return { valid: true };
}

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

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client getrennt. Aktive Clients: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Client error: ${err.message}`);
    clients.delete(ws);
  });
});

// Heartbeat: Dead Clients entfernen alle 30s
setInterval(() => {
  clients.forEach(ws => {
    if (!ws.isAlive) {
      console.log('[WS] Dead client entfernt');
      clients.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

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
      try {
        client.send(message);
        sent++;
      } catch (err) {
        console.error(`[WS] Send error: ${err.message}`);
        clients.delete(client);
      }
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

  // Name validieren
  if (!name || typeof name !== 'string' || name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: 'Ungültiger Name (max 100 Zeichen)' });
  }

  // Pfad validieren
  const pathValidation = validatePath(path);
  if (!pathValidation.valid) {
    return res.status(400).json({ error: pathValidation.error });
  }

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

  // Repo-Pfad validieren
  const pathValidation = validatePath(repo);
  if (!pathValidation.valid) {
    return res.status(400).json({ error: pathValidation.error });
  }

  // Task-Typ validieren
  if (!VALID_TASK_TYPES.includes(type)) {
    return res.status(400).json({ error: `Ungültiger Typ. Erlaubt: ${VALID_TASK_TYPES.join(', ')}` });
  }

  // Beschreibung validieren
  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'Beschreibung erforderlich' });
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return res.status(400).json({ error: `Beschreibung zu lang (max ${MAX_DESCRIPTION_LENGTH} Zeichen)` });
  }

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

// Task abbrechen
app.post('/api/tasks/abort', (req, res) => {
  const result = abortCurrentTask();
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
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
