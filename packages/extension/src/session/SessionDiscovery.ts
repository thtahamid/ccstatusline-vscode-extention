import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DiscoveredSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  entrypoint: string;
  transcriptPath: string | null;
}

interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
}

function getClaudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encode a cwd path to the directory name format Claude Code uses under ~/.claude/projects/
 * /Users/th/github/my_project → -Users-th-github-my-project
 */
function encodeCwdToProjectDir(cwd: string): string {
  return cwd.replace(/[/\\_ ]/g, '-');
}

/**
 * Find the transcript JSONL file for a session.
 * Looks in ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 */
function findTranscriptPath(sessionId: string, cwd: string): string | null {
  const claudeDir = getClaudeDir();
  const projectsDir = path.join(claudeDir, 'projects');

  // Try encoded cwd path first
  const encoded = encodeCwdToProjectDir(cwd);
  const directPath = path.join(projectsDir, encoded, `${sessionId}.jsonl`);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  // Fallback: scan project directories for matching sessionId
  if (!fs.existsSync(projectsDir)) return null;
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // ignore read errors
  }

  return null;
}

/**
 * Discover active Claude Code sessions.
 * Optionally filter by entrypoint and/or workspace folders.
 */
export function discoverActiveSessions(options?: {
  entrypoint?: string;
  workspaceFolders?: string[];
}): DiscoveredSession[] {
  const claudeDir = getClaudeDir();
  const sessionsDir = path.join(claudeDir, 'sessions');

  if (!fs.existsSync(sessionsDir)) return [];

  const sessions: DiscoveredSession[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
      const data: SessionFile = JSON.parse(raw);

      // Check PID is alive
      if (!isPidAlive(data.pid)) continue;

      // Filter by entrypoint
      if (options?.entrypoint && data.entrypoint !== options.entrypoint) continue;

      // Filter by workspace folders
      if (options?.workspaceFolders && options.workspaceFolders.length > 0) {
        const matches = options.workspaceFolders.some(folder =>
          data.cwd === folder || data.cwd.startsWith(folder + path.sep)
        );
        if (!matches) continue;
      }

      const transcriptPath = findTranscriptPath(data.sessionId, data.cwd);

      sessions.push({
        pid: data.pid,
        sessionId: data.sessionId,
        cwd: data.cwd,
        startedAt: data.startedAt,
        entrypoint: data.entrypoint,
        transcriptPath,
      });
    } catch {
      // skip corrupt session files
    }
  }

  // Most recent first
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return sessions;
}

/**
 * Find the best session for the current VS Code workspace.
 * Prefers claude-vscode sessions, falls back to CLI sessions.
 */
export function findBestSession(workspaceFolders: string[]): DiscoveredSession | null {
  // Try VS Code sessions first
  const vscodeSessions = discoverActiveSessions({
    entrypoint: 'claude-vscode',
    workspaceFolders,
  });
  if (vscodeSessions.length > 0) return vscodeSessions[0];

  // Fall back to any session matching workspace
  const anySessions = discoverActiveSessions({ workspaceFolders });
  if (anySessions.length > 0) return anySessions[0];

  // Fall back to most recent session overall
  const allSessions = discoverActiveSessions();
  return allSessions.length > 0 ? allSessions[0] : null;
}
