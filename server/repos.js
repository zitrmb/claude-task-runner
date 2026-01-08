import { readFileSync, writeFileSync, existsSync } from 'fs';
import { CONFIG } from './config.js';

let repos = [];

function loadRepos() {
  if (existsSync(CONFIG.REPOS_FILE)) {
    repos = JSON.parse(readFileSync(CONFIG.REPOS_FILE, 'utf-8'));
  }
}

function saveRepos() {
  writeFileSync(CONFIG.REPOS_FILE, JSON.stringify(repos, null, 2));
}

loadRepos();

export function getRepos() {
  return repos;
}

export function addRepo(name, path) {
  if (!repos.find(r => r.name === name)) {
    repos.push({ name, path });
    saveRepos();
  }
}

export function removeRepo(name) {
  repos = repos.filter(r => r.name !== name);
  saveRepos();
}
