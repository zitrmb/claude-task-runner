const API_BASE = '';
let ws;
let repos = [];
let queue = [];

// XSS-Schutz: HTML-Entities escapen
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// WebSocket verbinden mit Exponential Backoff
let wsReconnectDelay = 1000;
const WS_MAX_DELAY = 30000;

function connectWebSocket() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    console.log('[WS] Verbunden');
    wsReconnectDelay = 1000; // Reset delay on successful connection
  };

  ws.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);

    switch (type) {
      case 'task:added':
        queue.push(data);
        renderQueue();
        loadStats();
        break;
      case 'task:updated':
        const idx = queue.findIndex(t => t.id === data.id);
        if (idx !== -1) {
          queue[idx] = { ...queue[idx], ...data };
          renderQueue();
          loadStats();
        }
        break;
      case 'queue:updated':
        queue = data;
        renderQueue();
        loadStats();
        break;
      case 'terminal:output':
        appendTerminal(data.text);
        break;
    }
  };

  ws.onclose = () => {
    console.log(`[WS] Getrennt. Reconnect in ${wsReconnectDelay / 1000}s...`);
    setTimeout(connectWebSocket, wsReconnectDelay);
    // Exponential Backoff
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_MAX_DELAY);
  };

  ws.onerror = (err) => {
    console.error('[WS] Fehler:', err);
  };
}

// Repos laden
async function loadRepos() {
  try {
    const res = await fetch(`${API_BASE}/api/repos`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    repos = await res.json();
    renderRepos();
    renderRepoDropdown();
  } catch (err) {
    console.error('[API] Repos laden fehlgeschlagen:', err);
    alert('Fehler beim Laden der Repos. Server erreichbar?');
  }
}

function renderRepos() {
  const list = document.getElementById('repos-list');
  list.innerHTML = repos.map(r => `
    <li>
      <span><strong>${escapeHTML(r.name)}</strong> - ${escapeHTML(r.path)}</span>
      <button onclick="deleteRepo('${escapeHTML(r.name).replace(/'/g, "\\'")}')">x</button>
    </li>
  `).join('');
}

function renderRepoDropdown() {
  const select = document.getElementById('task-repo');
  select.innerHTML = repos.map(r =>
    `<option value="${escapeHTML(r.path)}">${escapeHTML(r.name)}</option>`
  ).join('');
}

async function addRepo() {
  const name = document.getElementById('repo-name').value.trim();
  const path = document.getElementById('repo-path').value.trim();

  if (!name || !path) return alert('Name und Pfad erforderlich!');

  try {
    const res = await fetch(`${API_BASE}/api/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Fehler: ${data.error || 'Unbekannter Fehler'}`);
      return;
    }

    document.getElementById('repo-name').value = '';
    document.getElementById('repo-path').value = '';
    loadRepos();
  } catch (err) {
    console.error('[API] Repo hinzufügen fehlgeschlagen:', err);
    alert('Fehler beim Hinzufügen des Repos');
  }
}

async function deleteRepo(name) {
  if (!confirm(`Repo "${name}" wirklich entfernen?`)) return;

  try {
    await fetch(`${API_BASE}/api/repos/${name}`, { method: 'DELETE' });
    loadRepos();
  } catch (err) {
    console.error('[API] Repo löschen fehlgeschlagen:', err);
    alert('Fehler beim Löschen des Repos');
  }
}

// Queue laden
async function loadQueue() {
  try {
    const res = await fetch(`${API_BASE}/api/queue`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    queue = await res.json();
    renderQueue();
  } catch (err) {
    console.error('[API] Queue laden fehlgeschlagen:', err);
  }
}

function renderQueue() {
  const list = document.getElementById('queue-list');
  const prioIcons = { high: '🔥', normal: '', low: '⬇' };

  list.innerHTML = queue.map(t => `
    <li class="priority-${escapeHTML(t.priority || 'normal')}">
      <div class="task-info">
        <span class="status-badge status-${escapeHTML(t.status)}">${escapeHTML(t.status)}</span>
        ${t.priority === 'high' ? '<span class="prio-icon">🔥</span>' : ''}
        <strong>${escapeHTML(t.type)}</strong>: ${escapeHTML(t.description.substring(0, 45))}...
      </div>
      <div class="task-actions">
        ${t.status === 'pending' ? `
          <select class="prio-select" onchange="setPriority('${escapeHTML(t.id)}', this.value)">
            <option value="high" ${t.priority === 'high' ? 'selected' : ''}>🔥</option>
            <option value="normal" ${t.priority === 'normal' || !t.priority ? 'selected' : ''}>—</option>
            <option value="low" ${t.priority === 'low' ? 'selected' : ''}>⬇</option>
          </select>
        ` : ''}
        ${t.status === 'failed' ? `<button class="retry-btn" onclick="retryTask('${escapeHTML(t.id)}')">Retry</button>` : ''}
        ${t.status !== 'running' && t.status !== 'testing' ? `<button class="delete-btn" onclick="deleteTask('${escapeHTML(t.id)}')">✕</button>` : ''}
      </div>
    </li>
  `).join('');
}

// Priorität ändern
async function setPriority(id, priority) {
  try {
    await fetch(`${API_BASE}/api/tasks/${id}/priority`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority })
    });
  } catch (err) {
    console.error('[API] Priority ändern fehlgeschlagen:', err);
  }
}

async function createTask() {
  const repo = document.getElementById('task-repo').value;
  const type = document.getElementById('task-type').value;
  const priority = document.getElementById('task-priority').value;
  const description = document.getElementById('task-description').value.trim();

  if (!repo || !description) return alert('Repo und Beschreibung erforderlich!');

  try {
    const res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, type, description, priority })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Fehler: ${data.error || 'Unbekannter Fehler'}`);
      return;
    }

    document.getElementById('task-description').value = '';
    document.getElementById('task-priority').value = 'normal';
    clearTerminal();
  } catch (err) {
    console.error('[API] Task erstellen fehlgeschlagen:', err);
    alert('Fehler beim Erstellen des Tasks');
  }
}

async function retryTask(id) {
  try {
    await fetch(`${API_BASE}/api/tasks/${id}/retry`, { method: 'POST' });
  } catch (err) {
    console.error('[API] Retry fehlgeschlagen:', err);
    alert('Fehler beim Retry');
  }
}

async function abortTask() {
  if (!confirm('Laufenden Task wirklich abbrechen?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/tasks/abort`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.message || 'Kein Task läuft');
    }
  } catch (err) {
    console.error('[API] Abort fehlgeschlagen:', err);
    alert('Fehler beim Abbrechen');
  }
}

// Einzelnen Task löschen
async function deleteTask(id) {
  if (!confirm('Task wirklich löschen?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/tasks/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.message || 'Fehler beim Löschen');
    }
  } catch (err) {
    console.error('[API] Delete fehlgeschlagen:', err);
    alert('Fehler beim Löschen');
  }
}

// Queue leeren
async function clearQueueTasks(filter = 'all') {
  const filterLabels = {
    all: 'alle Tasks (außer laufende)',
    done: 'erledigte Tasks',
    failed: 'fehlgeschlagene Tasks',
    completed: 'alle abgeschlossenen Tasks'
  };

  if (!confirm(`Wirklich ${filterLabels[filter]} löschen?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/queue?filter=${filter}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      console.log(`[Queue] ${data.removed} Tasks entfernt`);
    }
  } catch (err) {
    console.error('[API] Queue clear fehlgeschlagen:', err);
    alert('Fehler beim Leeren der Queue');
  }
}

// Statistiken laden
async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) return;
    const stats = await res.json();
    renderStats(stats);
  } catch (err) {
    console.error('[API] Stats laden fehlgeschlagen:', err);
  }
}

function renderStats(stats) {
  const container = document.getElementById('stats-display');
  if (!container) return;

  const avgMin = Math.floor(stats.avgDuration / 60);
  const avgSec = stats.avgDuration % 60;

  container.innerHTML = `
    <div class="stat-item">
      <span class="stat-value">${stats.total}</span>
      <span class="stat-label">Total</span>
    </div>
    <div class="stat-item">
      <span class="stat-value pending">${stats.pending}</span>
      <span class="stat-label">Pending</span>
    </div>
    <div class="stat-item">
      <span class="stat-value running">${stats.running + stats.testing}</span>
      <span class="stat-label">Running</span>
    </div>
    <div class="stat-item">
      <span class="stat-value done">${stats.done}</span>
      <span class="stat-label">Done</span>
    </div>
    <div class="stat-item">
      <span class="stat-value failed">${stats.failed}</span>
      <span class="stat-label">Failed</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">${stats.successRate}%</span>
      <span class="stat-label">Success</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">${avgMin}:${avgSec.toString().padStart(2, '0')}</span>
      <span class="stat-label">Avg Time</span>
    </div>
  `;
}

// Terminal
function appendTerminal(text) {
  const terminal = document.getElementById('terminal');
  terminal.textContent += text;
  terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
  document.getElementById('terminal').textContent = '';
}

// Init
connectWebSocket();
loadRepos();
loadQueue();
loadStats();
