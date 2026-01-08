import { exec } from 'child_process';

export function notifyFailure(task) {
  const title = 'Claude Task Runner';
  const message = `Task "${task.description.substring(0, 50)}..." ist 3x fehlgeschlagen!`;

  // macOS Notification
  const script = `display notification "${message}" with title "${title}" sound name "Basso"`;
  exec(`osascript -e '${script}'`);

  // Zusätzlicher Sound
  exec('afplay /System/Library/Sounds/Basso.aiff');

  console.log(`[Notification] ${message}`);
}

export function notifySuccess(task) {
  const title = 'Claude Task Runner';
  const message = `Task "${task.description.substring(0, 50)}..." abgeschlossen!`;

  const script = `display notification "${message}" with title "${title}" sound name "Glass"`;
  exec(`osascript -e '${script}'`);

  console.log(`[Notification] ${message}`);
}
