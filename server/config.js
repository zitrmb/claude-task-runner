export const CONFIG = {
  PORT: 2999,
  DATA_DIR: './data',
  QUEUE_FILE: './data/queue.json',
  REPOS_FILE: './data/repos.json',
  LOGS_DIR: './data/logs',
  MAX_RETRIES: 3,
  POLL_INTERVAL: 2000,  // ms
  MAX_TURNS: 20
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
