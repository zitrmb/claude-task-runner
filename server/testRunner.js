import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export function detectTestFramework(repoPath) {
  // Node.js / npm
  if (existsSync(join(repoPath, 'package.json'))) {
    return { cmd: 'npm', args: ['test'] };
  }

  // Python / pytest
  if (existsSync(join(repoPath, 'pytest.ini')) ||
      existsSync(join(repoPath, 'conftest.py')) ||
      existsSync(join(repoPath, 'setup.py'))) {
    return { cmd: 'pytest', args: ['-v'] };
  }

  // Go
  if (existsSync(join(repoPath, 'go.mod'))) {
    return { cmd: 'go', args: ['test', './...'] };
  }

  // Rust
  if (existsSync(join(repoPath, 'Cargo.toml'))) {
    return { cmd: 'cargo', args: ['test'] };
  }

  // Kein Framework erkannt
  return null;
}

export async function runTests(repoPath, taskId, broadcast) {
  const framework = detectTestFramework(repoPath);

  if (!framework) {
    broadcast('terminal:output', {
      taskId,
      text: '[INFO] Kein Test-Framework erkannt, überspringe Tests\n'
    });
    return { success: true, output: 'No tests' };
  }

  broadcast('terminal:output', {
    taskId,
    text: `[Test] Führe aus: ${framework.cmd} ${framework.args.join(' ')}\n`
  });

  return new Promise((resolve) => {
    const proc = spawn(framework.cmd, framework.args, { cwd: repoPath });
    let output = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      broadcast('terminal:output', { taskId, text });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      broadcast('terminal:output', { taskId, text });
    });

    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
  });
}
