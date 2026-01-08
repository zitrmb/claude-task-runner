export const CONFIG = {
  PORT: 2999,
  DATA_DIR: './data',
  QUEUE_FILE: './data/queue.json',
  REPOS_FILE: './data/repos.json',
  LOGS_DIR: './data/logs',
  MAX_RETRIES: 3,
  POLL_INTERVAL: 2000,  // ms
  MAX_TURNS: 30,  // Erhöht für komplexere Tasks

  // Model Settings
  DEFAULT_MODEL: 'sonnet',  // sonnet, opus, haiku
  EXTENDED_THINKING: true,  // Extended Thinking für komplexe Analysen
  THINKING_BUDGET: 10000,   // Token Budget für Extended Thinking

  // Performance Settings
  CONTEXT_CACHE: true,      // Projekt-Kontext cachen
  PARALLEL_TOOLS: true,     // Parallele Tool-Ausführung erlauben
};

export const ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'Bash(git:*)',
  'Bash(npm:*)',
  'Bash(npx:*)',
  'Bash(pytest:*)',
  'Bash(python:*)',
  'Bash(node:*)'
].join(',');
