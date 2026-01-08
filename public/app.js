const API_BASE = '';
let ws;
let repos = [];
let queue = [];

// WebSocket verbinden
function connectWebSocket() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);

    switch (type) {
      case 'task:added':
        queue.push(data);
        renderQueue();
        break;
      case 'task:updated':
        const idx = queue.findIndex(t => t.id === data.id);
        if (idx !== -1) {
          queue[idx] = { ...queue[idx], ...data };
          renderQueue();
        }
        break;
      case 'terminal:output':
        appendTerminal(data.text);
        break;
    }
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 1000);
  };
}

// Repos laden
async function loadRepos() {
  const res = await fetch(`${API_BASE}/api/repos`);
  repos = await res.json();
  renderRepos();
  renderRepoDropdown();
}

function renderRepos() {
  const list = document.getElementById('repos-list');
  list.innerHTML = repos.map(r => `
    <li>
      <span><strong>${r.name}</strong> - ${r.path}</span>
      <button onclick="deleteRepo('${r.name}')">x</button>
    </li>
  `).join('');
}

function renderRepoDropdown() {
  const select = document.getElementById('task-repo');
  select.innerHTML = repos.map(r =>
    `<option value="${r.path}">${r.name}</option>`
  ).join('');
}

async function addRepo() {
  const name = document.getElementById('repo-name').value.trim();
  const path = document.getElementById('repo-path').value.trim();

  if (!name || !path) return alert('Name und Pfad erforderlich!');

  await fetch(`${API_BASE}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path })
  });

  document.getElementById('repo-name').value = '';
  document.getElementById('repo-path').value = '';
  loadRepos();
}

async function deleteRepo(name) {
  await fetch(`${API_BASE}/api/repos/${name}`, { method: 'DELETE' });
  loadRepos();
}

// Queue laden
async function loadQueue() {
  const res = await fetch(`${API_BASE}/api/queue`);
  queue = await res.json();
  renderQueue();
}

function renderQueue() {
  const list = document.getElementById('queue-list');
  list.innerHTML = queue.map(t => `
    <li>
      <div>
        <span class="status-badge status-${t.status}">${t.status}</span>
        <strong>${t.type}</strong>: ${t.description.substring(0, 50)}...
      </div>
      <div>
        ${t.status === 'failed' ? `<button class="retry-btn" onclick="retryTask('${t.id}')">Retry</button>` : ''}
      </div>
    </li>
  `).join('');
}

async function createTask() {
  const repo = document.getElementById('task-repo').value;
  const type = document.getElementById('task-type').value;
  const description = document.getElementById('task-description').value.trim();

  if (!repo || !description) return alert('Repo und Beschreibung erforderlich!');

  await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, type, description })
  });

  document.getElementById('task-description').value = '';
  clearTerminal();
}

async function retryTask(id) {
  await fetch(`${API_BASE}/api/tasks/${id}/retry`, { method: 'POST' });
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
