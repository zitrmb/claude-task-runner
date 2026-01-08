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

export function addTask(repoPath, type, description, priority = 'normal') {
  const task = {
    id: `task_${Date.now()}`,
    repo: repoPath,
    type,  // feature | bugfix | refactor
    description,
    status: 'pending',
    priority, // high | normal | low
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
  // Priorität: high > normal > low, dann nach createdAt
  const priorityOrder = { high: 0, normal: 1, low: 2 };
  const pending = queue.filter(t => t.status === 'pending');

  if (pending.length === 0) return null;

  pending.sort((a, b) => {
    const prioA = priorityOrder[a.priority] ?? 1;
    const prioB = priorityOrder[b.priority] ?? 1;
    if (prioA !== prioB) return prioA - prioB;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  return pending[0];
}

// Task nach oben/unten verschieben
export function moveTask(id, direction) {
  const index = queue.findIndex(t => t.id === id);
  if (index === -1) return { success: false, message: 'Task nicht gefunden' };

  const task = queue[index];
  if (task.status !== 'pending') {
    return { success: false, message: 'Nur pending Tasks können verschoben werden' };
  }

  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= queue.length) {
    return { success: false, message: 'Kann nicht weiter verschoben werden' };
  }

  // Tauschen
  [queue[index], queue[newIndex]] = [queue[newIndex], queue[index]];
  saveQueue();
  return { success: true };
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

// Queue leeren (mit Filter-Option)
export function clearQueue(filter = 'all') {
  const beforeCount = queue.length;
  let removed = 0;

  switch (filter) {
    case 'done':
      // Nur erledigte Tasks entfernen
      queue = queue.filter(t => t.status !== 'done');
      break;
    case 'failed':
      // Nur fehlgeschlagene Tasks entfernen
      queue = queue.filter(t => t.status !== 'failed');
      break;
    case 'completed':
      // Done + Failed entfernen (alles außer pending/running)
      queue = queue.filter(t => t.status === 'pending' || t.status === 'running' || t.status === 'testing');
      break;
    case 'all':
    default:
      // Alles außer laufenden Tasks entfernen
      queue = queue.filter(t => t.status === 'running' || t.status === 'testing');
      break;
  }

  removed = beforeCount - queue.length;
  saveQueue();
  console.log(`[Queue] ${removed} Tasks entfernt (Filter: ${filter})`);
  return { removed, remaining: queue.length };
}

// Task löschen
export function deleteTask(id) {
  const index = queue.findIndex(t => t.id === id);
  if (index !== -1) {
    const task = queue[index];
    // Laufende Tasks nicht löschen
    if (task.status === 'running' || task.status === 'testing') {
      return { success: false, message: 'Laufende Tasks können nicht gelöscht werden' };
    }
    queue.splice(index, 1);
    saveQueue();
    return { success: true, message: 'Task gelöscht' };
  }
  return { success: false, message: 'Task nicht gefunden' };
}

// Statistiken
export function getStats() {
  const stats = {
    total: queue.length,
    pending: 0,
    running: 0,
    testing: 0,
    done: 0,
    failed: 0,
    avgDuration: 0,
    successRate: 0
  };

  let totalDuration = 0;
  let completedCount = 0;

  for (const task of queue) {
    stats[task.status] = (stats[task.status] || 0) + 1;

    if (task.completedAt && task.createdAt) {
      const duration = new Date(task.completedAt) - new Date(task.createdAt);
      totalDuration += duration;
      completedCount++;
    }
  }

  if (completedCount > 0) {
    stats.avgDuration = Math.round(totalDuration / completedCount / 1000); // in Sekunden
  }

  const finished = stats.done + stats.failed;
  if (finished > 0) {
    stats.successRate = Math.round((stats.done / finished) * 100);
  }

  return stats;
}
