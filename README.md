# Claude Task Runner

Automatisiertes System zur sequentiellen Task-Abarbeitung mit der Claude Code CLI. Erstelle Tasks, lass Claude sie implementieren, und erhalte fertige Pull Requests.

## Architektur

```
┌─────────────────────────────────────────┐
│  Web App (localhost:3000)               │
│  - Task-Queue mit Live-Status           │
│  - Repository-Verwaltung                │
│  - Live Terminal Output (WebSocket)     │
└──────────────┬──────────────────────────┘
               │ WebSocket
               ▼
┌─────────────────────────────────────────┐
│  Node.js Backend                        │
│  - Spawnt Claude Code CLI               │
│  - Parst NDJSON-Stream live             │
│  - Retry-Logik (3 Versuche)             │
│  - Auto Test-Runner                     │
│  - macOS Notifications                  │
└─────────────────────────────────────────┘
```

## Voraussetzungen

### 1. Node.js
```bash
node -v  # Falls nicht installiert: brew install node
```

### 2. Claude Code CLI
```bash
claude --version  # Muss installiert und konfiguriert sein
```

### 3. GitHub CLI
```bash
gh --version      # Falls nicht: brew install gh
gh auth status    # Falls nicht eingeloggt: gh auth login
```

## Installation

```bash
cd claude-worker-helper
npm install
```

## Starten

```bash
# Entwicklungsmodus (mit Auto-Reload)
npm run dev

# Produktionsmodus
npm start
```

Dann öffne **http://localhost:3000**

## Nutzung

### 1. Repository hinzufügen

In der Web-UI unter "Repositories":

| Feld | Beispiel |
|------|----------|
| Name | `my-coverband` |
| Pfad | `/Users/sebastian/Projects/my-coverband` |

**Wichtig:**
- Der Pfad muss absolut sein
- Das Verzeichnis muss ein Git-Repository sein
- Es muss ein Remote (`origin`) konfiguriert sein

### 2. Task erstellen

| Feld | Beschreibung |
|------|--------------|
| **Repo** | Wähle das Ziel-Repository |
| **Typ** | `feature` / `bugfix` / `refactor` |
| **Beschreibung** | Detaillierte Aufgabenbeschreibung |

**Beispiele für gute Task-Beschreibungen:**

```
Feature:
"Füge eine neue API-Route /api/bookings hinzu, die alle Buchungen
aus der Datenbank zurückgibt. Nutze das bestehende Prisma-Schema."

Bugfix:
"Der Login-Button auf der Startseite reagiert nicht auf Klicks
wenn JavaScript deaktiviert ist. Füge einen Fallback hinzu."

Refactor:
"Extrahiere die Validierungslogik aus UserController.js in
eine separate Datei validators/userValidator.js"
```

### 3. Task-Ablauf

Nach dem Klick auf "Task starten":

1. **Branch erstellen**
   - Automatisch: `feature/task_1704672000000`

2. **Phase 1: Plan**
   - Claude analysiert die Aufgabe
   - Erstellt Schritt-für-Schritt Plan
   - Noch kein Code!

3. **Phase 2: Implementation**
   - Claude führt den Plan aus
   - Schreibt/ändert Code
   - Nutzt nur erlaubte Tools

4. **Phase 3: Tests**
   - Automatische Framework-Erkennung (npm/pytest/go/cargo)
   - Bei Fehlern: Claude versucht zu fixen (max. 3x)

5. **Phase 4: PR**
   - `git add -A`
   - `git commit`
   - `git push`
   - `gh pr create`

### 4. Status-Übersicht

| Status | Bedeutung |
|--------|-----------|
| `pending` | Wartet auf Ausführung |
| `running` | Claude arbeitet |
| `testing` | Tests laufen |
| `done` | Erfolgreich, PR erstellt |
| `failed` | Fehlgeschlagen (Retry möglich) |

### 5. Bei Fehlern

- **Retry-Button:** Startet den Task erneut
- **Notification:** macOS-Benachrichtigung nach 3 Fehlversuchen
- **Logs:** Im Terminal-Bereich sichtbar

## Konfiguration

Bearbeite `server/config.js`:

```javascript
export const CONFIG = {
  PORT: 3000,           // Server-Port
  MAX_RETRIES: 3,       // Wiederholungsversuche
  POLL_INTERVAL: 2000,  // Queue-Check Intervall (ms)
  MAX_TURNS: 20         // Max. Claude-Interaktionen
};

// Erlaubte Tools für Claude
export const ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit',
  'Glob', 'Grep',
  'Bash(git:*)', 'Bash(npm:*)', 'Bash(npx:*)',
  'Bash(pytest:*)', 'Bash(python:*)', 'Bash(node:*)'
].join(',');
```

## Dateistruktur

```
claude-worker-helper/
├── server/
│   ├── index.js        # Express + WebSocket Server
│   ├── config.js       # Konfiguration
│   ├── queue.js        # Task-Queue Management
│   ├── repos.js        # Repository-Verwaltung
│   ├── executor.js     # Claude CLI Integration
│   ├── testRunner.js   # Test-Framework Erkennung
│   └── notifier.js     # macOS Notifications
├── public/
│   ├── index.html      # Web-UI
│   ├── app.js          # Frontend-Logik
│   └── style.css       # Styling
├── data/
│   ├── queue.json      # Aktive Tasks
│   ├── repos.json      # Gespeicherte Repos
│   └── logs/           # Task-Logs
└── package.json
```

## API-Endpunkte

| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| GET | `/api/repos` | Alle Repositories |
| POST | `/api/repos` | Repo hinzufügen |
| DELETE | `/api/repos/:name` | Repo entfernen |
| GET | `/api/queue` | Alle Tasks |
| POST | `/api/tasks` | Neuen Task erstellen |
| POST | `/api/tasks/:id/retry` | Task wiederholen |

## WebSocket Events

| Event | Richtung | Daten |
|-------|----------|-------|
| `task:added` | Server → Client | Neuer Task |
| `task:updated` | Server → Client | Status-Update |
| `terminal:output` | Server → Client | Claude-Output |

## Tipps

### Gute Task-Beschreibungen

- **Spezifisch:** "Füge Feld `email` zu User-Model hinzu" statt "Erweitere User"
- **Kontext:** Erwähne relevante Dateien/Frameworks
- **Grenzen:** Sage was NICHT gemacht werden soll

### Workflow-Empfehlung

1. Große Features in kleine Tasks aufteilen
2. Ein Task = Ein logischer Commit
3. Nach jedem PR: Review + Merge, dann nächster Task

### Troubleshooting

| Problem | Lösung |
|---------|--------|
| Port belegt | `lsof -ti:3000 \| xargs kill -9` |
| Claude nicht gefunden | Claude Code CLI installieren |
| PR-Erstellung fehlgeschlagen | `gh auth login` ausführen |
| Tests hängen | Timeout in testRunner.js erhöhen |

## Erweiterungsideen

- [ ] Task-Priorisierung (high/medium/low)
- [ ] Telegram/Slack-Benachrichtigungen
- [ ] Task-History mit Suchfunktion
- [ ] Parallele Tasks (verschiedene Repos)
- [ ] GitHub Issues → Tasks Import
- [ ] Scheduled Tasks (Cron)

## Lizenz

MIT
