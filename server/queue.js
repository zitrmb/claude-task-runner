import { readFileSync, writeFileSync, existsSync } from 'fs';
import { CONFIG } from './config.js';

let queue = [];

export function initQueue() {
  if (existsSync(CONFIG.QUEUE_FILE)) {
    queue = JSON.parse(readFileSync(CONFIG.QUEUE_FILE, 'utf-8'));
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
