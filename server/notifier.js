import { execFile, exec } from 'child_process';

// Escape für AppleScript-Strings (Backslash und Quotes)
function escapeAppleScript(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}

export function notifyFailure(task) {
  const title = 'Claude Task Runner';
  const desc = escapeAppleScript(task.description.substring(0, 50));
  const message = `Task "${desc}..." ist 3x fehlgeschlagen!`;

  // macOS Notification - execFile statt exec (kein Shell)
  const script = `display notification "${message}" with title "${title}" sound name "Basso"`;
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('[Notification] Error:', err.message);
  });

  // Sound abspielen
  execFile('afplay', ['/System/Library/Sounds/Basso.aiff']);

  console.log(`[Notification] ${message}`);
}

export function notifySuccess(task) {
  const title = 'Claude Task Runner';
  const desc = escapeAppleScript(task.description.substring(0, 50));
  const message = `Task "${desc}..." abgeschlossen!`;

  const script = `display notification "${message}" with title "${title}" sound name "Glass"`;
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('[Notification] Error:', err.message);
  });

  console.log(`[Notification] ${message}`);
}
