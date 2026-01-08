import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { CONFIG } from './config.js';
import { getNextPendingTask, updateTask, appendLog } from './queue.js';
import { runTests, detectTestFramework } from './testRunner.js';
import { notifyFailure, notifySuccess } from './notifier.js';

let isProcessing = false;
let currentTaskId = null;
let currentBroadcast = null;

// Hilfsfunktion: Log an Console UND Browser senden
function log(message, taskId = currentTaskId) {
  const timestamp = new Date().toLocaleTimeString('de-DE');
  const fullMsg = `[${timestamp}] ${message}`;
  console.log(fullMsg);
  if (currentBroadcast && taskId) {
    currentBroadcast('terminal:output', { taskId, text: fullMsg + '\n' });
  }
}

export async function processNextTask(broadcast) {
  if (isProcessing) {
    return;
  }

  const task = getNextPendingTask();
  if (!task) {
    return;
  }

  currentTaskId = task.id;
  currentBroadcast = broadcast;

  log(`[Worker] Starte Task: ${task.id}`);
  log(`[Worker] Beschreibung: ${task.description}`);
  isProcessing = true;

  try {
    await executeTask(task, broadcast);
  } catch (error) {
    console.error('[Worker] Task execution error:', error);
    log(`[CRASH] ${error.message}`);
    broadcast('terminal:output', { taskId: task.id, text: `${error.stack}\n` });
  } finally {
    isProcessing = false;
    log(`[Worker] Task beendet: ${task.id}`);
    currentTaskId = null;
  }
}

async function executeTask(task, broadcast) {
  const branchName = `${task.type}/${task.id}`;

  // Pfad bereinigen (entferne eventuelle Anführungszeichen)
  const repoPath = task.repo.replace(/^['"]|['"]$/g, '');

  // Prüfe ob Verzeichnis existiert
  if (!existsSync(repoPath)) {
    broadcast('terminal:output', { taskId: task.id, text: `\n[ERROR] Verzeichnis existiert nicht: ${repoPath}\n` });
    return handleFailure(task, `Verzeichnis nicht gefunden: ${repoPath}`, broadcast);
  }

  updateTask(task.id, { status: 'running', branch: branchName });
  broadcast('task:updated', { id: task.id, status: 'running', branch: branchName });

  // Schritt 1: Branch erstellen
  broadcast('terminal:output', { taskId: task.id, text: `\n========================================\n` });
  broadcast('terminal:output', { taskId: task.id, text: `[Repo] ${repoPath}\n` });
  broadcast('terminal:output', { taskId: task.id, text: `[Branch] ${branchName}\n` });
  broadcast('terminal:output', { taskId: task.id, text: `[Task] ${task.description}\n` });
  broadcast('terminal:output', { taskId: task.id, text: `========================================\n\n` });

  broadcast('terminal:output', { taskId: task.id, text: `[Git] Erstelle Branch: ${branchName}...\n` });
  const gitCheckout = await runCommand('git', ['checkout', '-b', branchName], repoPath);
  if (!gitCheckout.success) {
    broadcast('terminal:output', { taskId: task.id, text: `[Git] Branch existiert, wechsle zu: ${branchName}\n` });
    const switchResult = await runCommand('git', ['checkout', branchName], repoPath);
    if (switchResult.output) {
      broadcast('terminal:output', { taskId: task.id, text: `[Git] ${switchResult.output}\n` });
    }
  } else {
    broadcast('terminal:output', { taskId: task.id, text: `[Git] Branch erstellt.\n` });
  }

  // Schritt 2: Plan erstellen
  broadcast('terminal:output', { taskId: task.id, text: '\n----------------------------------------\n' });
  broadcast('terminal:output', { taskId: task.id, text: '[Phase 1/4] PLAN ERSTELLEN\n' });
  broadcast('terminal:output', { taskId: task.id, text: '----------------------------------------\n' });

  const planPrompt = `
Analysiere diese Aufgabe und erstelle einen Schritt-für-Schritt Plan.
NOCH KEINEN CODE SCHREIBEN!

Aufgabe: ${task.description}
Typ: ${task.type}

Antworte NUR mit dem Plan als nummerierte Liste.
`;

  const planResult = await runClaude(planPrompt, repoPath, task.id, broadcast);

  if (!planResult.success) {
    return handleFailure(task, 'Plan-Erstellung fehlgeschlagen', broadcast);
  }

  // Schritt 3: Plan ausführen
  broadcast('terminal:output', { taskId: task.id, text: '\n----------------------------------------\n' });
  broadcast('terminal:output', { taskId: task.id, text: '[Phase 2/4] IMPLEMENTATION\n' });
  broadcast('terminal:output', { taskId: task.id, text: '----------------------------------------\n' });

  const executePrompt = `
Führe jetzt den Plan aus und implementiere die Änderungen.

Aufgabe: ${task.description}
Branch: ${branchName}

Wichtig:
- Schreibe sauberen, getesteten Code
- Committe NICHT selbst, das macht das System
- Wenn du fertig bist, antworte mit "IMPLEMENTATION_COMPLETE"
`;

  const execResult = await runClaude(executePrompt, repoPath, task.id, broadcast);

  if (!execResult.success) {
    return handleFailure(task, 'Implementation fehlgeschlagen', broadcast);
  }

  // Schritt 4: Tests ausführen
  broadcast('terminal:output', { taskId: task.id, text: '\n----------------------------------------\n' });
  broadcast('terminal:output', { taskId: task.id, text: '[Phase 3/4] TESTS\n' });
  broadcast('terminal:output', { taskId: task.id, text: '----------------------------------------\n' });
  updateTask(task.id, { status: 'testing' });
  broadcast('task:updated', { id: task.id, status: 'testing' });

  const testResult = await runTests(repoPath, task.id, broadcast);

  if (!testResult.success) {
    // Retry mit Fehler-Feedback
    if (task.retries < CONFIG.MAX_RETRIES) {
      broadcast('terminal:output', { taskId: task.id, text: '\n----------------------------------------\n' });
      broadcast('terminal:output', { taskId: task.id, text: `[RETRY ${task.retries + 1}/${CONFIG.MAX_RETRIES}] Tests fehlgeschlagen, Claude versucht zu fixen...\n` });
      broadcast('terminal:output', { taskId: task.id, text: '----------------------------------------\n' });

      const fixPrompt = `
Die Tests sind fehlgeschlagen. Behebe die Fehler:

${testResult.output}

Wenn gefixt, antworte mit "FIXES_COMPLETE"
`;

      await runClaude(fixPrompt, repoPath, task.id, broadcast);
      updateTask(task.id, { retries: task.retries + 1 });

      // Rekursiv nochmal testen
      return executeTask({ ...task, retries: task.retries + 1 }, broadcast);
    }

    return handleFailure(task, 'Tests 3x fehlgeschlagen', broadcast);
  }

  // Schritt 5: Commit + Push + PR
  broadcast('terminal:output', { taskId: task.id, text: '\n----------------------------------------\n' });
  broadcast('terminal:output', { taskId: task.id, text: '[Phase 4/4] GIT COMMIT & PR\n' });
  broadcast('terminal:output', { taskId: task.id, text: '----------------------------------------\n' });

  broadcast('terminal:output', { taskId: task.id, text: '[Git] Stage all changes...\n' });
  const addResult = await runCommand('git', ['add', '-A'], repoPath);

  broadcast('terminal:output', { taskId: task.id, text: `[Git] Commit: [${task.type}] ${task.description.substring(0, 50)}...\n` });
  const commitResult = await runCommand('git', ['commit', '-m', `[${task.type}] ${task.description}`], repoPath);
  if (commitResult.output) {
    broadcast('terminal:output', { taskId: task.id, text: `[Git] ${commitResult.output}\n` });
  }

  broadcast('terminal:output', { taskId: task.id, text: `[Git] Push to origin/${branchName}...\n` });
  const pushResult = await runCommand('git', ['push', '-u', 'origin', branchName], repoPath);
  if (pushResult.output) {
    broadcast('terminal:output', { taskId: task.id, text: `[Git] ${pushResult.output}\n` });
  }

  broadcast('terminal:output', { taskId: task.id, text: '[GitHub] Creating Pull Request...\n' });
  const prResult = await runCommand('gh', ['pr', 'create', '--fill', '--base', 'main'], repoPath);

  if (prResult.success) {
    broadcast('terminal:output', { taskId: task.id, text: `\n[OK] PR erstellt!\n${prResult.output}\n` });

    // Auto-Merge: PR direkt mergen
    broadcast('terminal:output', { taskId: task.id, text: '[GitHub] Auto-Merge: Merge PR...\n' });
    const mergeResult = await runCommand('gh', ['pr', 'merge', '--squash', '--delete-branch'], repoPath);

    if (mergeResult.success) {
      broadcast('terminal:output', { taskId: task.id, text: `[OK] PR gemerged & Branch gelöscht!\n` });
    } else {
      broadcast('terminal:output', { taskId: task.id, text: `[WARN] Auto-Merge fehlgeschlagen: ${mergeResult.output}\n` });
    }
  } else {
    broadcast('terminal:output', { taskId: task.id, text: `[WARN] PR-Erstellung: ${prResult.output}\n` });
  }

  // Fertig!
  updateTask(task.id, {
    status: 'done',
    completedAt: new Date().toISOString()
  });
  broadcast('task:updated', { id: task.id, status: 'done' });
  broadcast('terminal:output', { taskId: task.id, text: '\n========================================\n' });
  broadcast('terminal:output', { taskId: task.id, text: '[SUCCESS] TASK ABGESCHLOSSEN!\n' });
  broadcast('terminal:output', { taskId: task.id, text: `[Branch] ${branchName}\n` });
  broadcast('terminal:output', { taskId: task.id, text: '========================================\n' });
  notifySuccess(task);
}

async function runClaude(prompt, cwd, taskId, broadcast) {
  return new Promise((resolve) => {
    // Args für claude ohne shell substitution
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--max-turns', String(CONFIG.MAX_TURNS)
    ];

    let claude;
    console.log(`[Claude] Running: claude --output-format stream-json... in ${cwd}`);
    broadcast('terminal:output', { taskId, text: `[Claude] Starte Claude CLI...\n` });
    try {
      // Spawn ohne shell, prompt über stdin
      claude = spawn('claude', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' }
      });
      console.log(`[Claude] Spawn successful, PID: ${claude.pid}`);
      broadcast('terminal:output', { taskId, text: `[Claude] Prozess gestartet (PID: ${claude.pid})\n` });

      // Prompt über stdin senden
      console.log(`[Claude] Sending prompt via stdin (${prompt.length} chars)...`);
      claude.stdin.write(prompt);
      claude.stdin.end();
      console.log(`[Claude] Stdin closed, waiting for output...`);
    } catch (err) {
      console.log(`[Claude] Spawn FAILED: ${err.message}`);
      broadcast('terminal:output', { taskId, text: `[ERROR] Claude spawn failed: ${err.message}\n` });
      return resolve({ success: false, output: err.message });
    }

    let fullOutput = '';

    claude.on('error', (err) => {
      broadcast('terminal:output', { taskId, text: `[ERROR] Claude error: ${err.message}\n` });
      resolve({ success: false, output: err.message });
    });

    claude.stdout.on('data', (data) => {
      const rawData = data.toString();
      console.log(`[Claude stdout] Received ${rawData.length} bytes`);
      const lines = rawData.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);

          // Verschiedene Event-Typen verarbeiten
          switch (json.type) {
            case 'system':
              // System-Init Nachrichten
              if (json.subtype === 'init') {
                broadcast('terminal:output', {
                  taskId,
                  text: `\n[System] Session gestartet (${json.session_id?.substring(0, 8)}...)\n`
                });
              }
              break;

            case 'assistant':
              // Assistant-Antworten mit Content-Blocks
              if (json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === 'text') {
                    broadcast('terminal:output', { taskId, text: block.text + '\n' });
                    fullOutput += block.text;
                  }
                  if (block.type === 'tool_use') {
                    // Tool-Aufruf mit Details
                    const inputPreview = JSON.stringify(block.input || {}).substring(0, 200);
                    broadcast('terminal:output', {
                      taskId,
                      text: `\n┌─ [Tool] ${block.name}\n│  ${inputPreview}${inputPreview.length >= 200 ? '...' : ''}\n`
                    });
                  }
                }
              }
              break;

            case 'user':
              // Tool-Ergebnisse
              if (json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === 'tool_result') {
                    const resultPreview = String(block.content || '').substring(0, 300);
                    const status = block.is_error ? 'ERROR' : 'OK';
                    broadcast('terminal:output', {
                      taskId,
                      text: `└─ [Result: ${status}] ${resultPreview}${resultPreview.length >= 300 ? '...' : ''}\n`
                    });
                  }
                }
              }
              break;

            case 'result':
              // Abschluss-Event
              broadcast('terminal:output', {
                taskId,
                text: `\n[Done] Turns: ${json.num_turns || '?'}, Kosten: $${json.cost_usd?.toFixed(4) || '?'}\n`
              });
              break;

            case 'error':
              // Fehler-Event
              broadcast('terminal:output', {
                taskId,
                text: `\n[ERROR] ${json.error?.message || JSON.stringify(json)}\n`
              });
              break;

            default:
              // Unbekannte Events auch loggen (Debug)
              if (json.type) {
                broadcast('terminal:output', {
                  taskId,
                  text: `[${json.type}] ${json.subtype || ''}\n`
                });
              }
          }
        } catch (e) {
          // Kein gültiges JSON, raw output anzeigen
          if (line.trim()) {
            broadcast('terminal:output', { taskId, text: `${line}\n` });
          }
        }
      }
    });

    claude.stderr.on('data', (data) => {
      console.log(`[Claude stderr] ${data.toString()}`);
      broadcast('terminal:output', { taskId, text: `[WARN] ${data.toString()}` });
    });

    claude.on('close', (code) => {
      console.log(`[Claude] Process exited with code ${code}`);
      broadcast('terminal:output', { taskId, text: `\n[Claude] Beendet mit Code ${code}\n` });
      resolve({
        success: code === 0,
        output: fullOutput
      });
    });
  });
}

async function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, { cwd });
      let output = '';

      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());

      proc.on('error', (err) => {
        resolve({ success: false, output: `Spawn error: ${err.message}` });
      });

      proc.on('close', (code) => {
        resolve({ success: code === 0, output });
      });
    } catch (err) {
      resolve({ success: false, output: `Error: ${err.message}` });
    }
  });
}

function handleFailure(task, reason, broadcast) {
  updateTask(task.id, { status: 'failed' });
  broadcast('task:updated', { id: task.id, status: 'failed' });
  broadcast('terminal:output', { taskId: task.id, text: `\n[FAIL] ${reason}\n` });
  appendLog(task.id, reason);

  if (task.retries >= CONFIG.MAX_RETRIES - 1) {
    notifyFailure(task);
  }
}
