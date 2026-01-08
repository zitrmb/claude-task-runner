import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { CONFIG } from './config.js';

let queue = [];

export function initQueue() {
  if (existsSync(CONFIG.QUEUE_FILE)) {
    try {
      const content = readFileSync(CONFIG.QUEUE_FILE, 'utf-8');
      queue = JSON.parse(content);

      // Validiere Array-Struktur
      if (!Array.isArray(queue)) {
        throw new Error('Queue ist kein Array');
      }

      console.log(`[Queue] ${queue.length} Tasks geladen`);

      // Crash-Recovery: "running" Tasks auf "pending" zurücksetzen
      let recovered = 0;
      for (const task of queue) {
        if (task.status === 'running' || task.status === 'testing') {
          task.status = 'pending';
          task.retries = 0;
          recovered++;
        }
      }
      if (recovered > 0) {
        saveQueue();
        console.log(`[Queue] ${recovered} steckengebliebene Tasks wiederhergestellt`);
      }
    } catch (err) {
      console.error(`[Queue] FEHLER beim Laden: ${err.message}`);

      // Backup der korrupten Datei erstellen
      const backupPath = `${CONFIG.QUEUE_FILE}.corrupt.${Date.now()}`;
      try {
        copyFileSync(CONFIG.QUEUE_FILE, backupPath);
        console.log(`[Queue] Backup erstellt: ${backupPath}`);
      } catch (e) {
        // Backup fehlgeschlagen, ignorieren
      }

      // Leere Queue starten
      queue = [];
      saveQueue();
      console.log('[Queue] Leere Queue initialisiert');
    }
  } else {
    saveQueue();
  }
}

function saveQueue() {
  writeFileSync(CONFIG.QUEUE_FILE, JSON.stringify(queue, null, 2));
}

export function getQueue() {
  return queue;
}

export function addTask(repoPath, type, description) {
  const task = {
    id: `task_${Date.now()}`,
    repo: repoPath,
    type,  // feature | bugfix | refactor
    description,
    status: 'pending',
    retries: 0,
    branch: null,
    logs: [],
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  queue.push(task);
  saveQueue();
  return task;
}

export function updateTask(id, updates) {
  const index = queue.findIndex(t => t.id === id);
  if (index !== -1) {
    queue[index] = { ...queue[index], ...updates };
    saveQueue();
    return queue[index];
  }
  return null;
}

export function getNextPendingTask() {
  return queue.find(t => t.status === 'pending');
}

export function appendLog(id, message) {
  const task = queue.find(t => t.id === id);
  if (task) {
    task.logs.push({
      timestamp: new Date().toISOString(),
      message
    });
    saveQueue();
  }
}
