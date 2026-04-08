import * as fs from 'fs';
import type { DiscoveredSession } from './SessionDiscovery';

interface TranscriptAssistantEntry {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface TranscriptAiTitleEntry {
  type?: string;
  sessionId?: string;
  aiTitle?: string;
}

interface BuiltStatusJSON {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  model?: string | { id?: string; display_name?: string };
  version?: string;
  cost?: {
    total_duration_ms?: number;
  };
  context_window?: {
    context_window_size?: number | null;
    total_input_tokens?: number | null;
    total_output_tokens?: number | null;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
  } | null;
}

/**
 * Read the last N bytes of a file and extract JSONL lines from it.
 * For large files, only reads the tail for efficiency.
 */
function readTranscriptTail(filePath: string, maxBytes = 65536): TranscriptAssistantEntry[] {
  const stat = fs.statSync(filePath);
  const entries: TranscriptAssistantEntry[] = [];

  let content: string;
  if (stat.size <= maxBytes) {
    content = fs.readFileSync(filePath, 'utf8');
  } else {
    // Read only the tail
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    fs.readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes);
    fs.closeSync(fd);
    content = buffer.toString('utf8');
    // Skip partial first line
    const firstNewline = content.indexOf('\n');
    if (firstNewline !== -1) {
      content = content.substring(firstNewline + 1);
    }
  }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  return entries;
}

/**
 * Find the last non-sidechain assistant entry from a transcript.
 */
function findLastAssistantEntry(entries: TranscriptAssistantEntry[]): TranscriptAssistantEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'assistant' && !entry.isSidechain && !entry.isApiErrorMessage && entry.message?.usage) {
      return entry;
    }
  }
  return null;
}

/**
 * Find the session name (ai-title) from transcript entries.
 */
function findSessionName(entries: TranscriptAssistantEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as unknown as TranscriptAiTitleEntry;
    if (entry.type === 'ai-title' && entry.aiTitle) {
      return entry.aiTitle;
    }
  }
  return null;
}

/**
 * Build a StatusJSON object from a discovered session's disk data.
 * This mirrors the JSON that Claude Code normally pipes to ccstatusline via stdin.
 */
export function buildStatusJSON(session: DiscoveredSession): BuiltStatusJSON {
  const result: BuiltStatusJSON = {
    session_id: session.sessionId,
    transcript_path: session.transcriptPath ?? undefined,
    cwd: session.cwd,
    cost: {
      total_duration_ms: Date.now() - session.startedAt,
    },
  };

  if (!session.transcriptPath || !fs.existsSync(session.transcriptPath)) {
    return result;
  }

  const entries = readTranscriptTail(session.transcriptPath);
  const lastEntry = findLastAssistantEntry(entries);

  if (lastEntry) {
    // Model
    if (lastEntry.message?.model) {
      result.model = lastEntry.message.model;
    }

    // Version
    if (lastEntry.version) {
      result.version = lastEntry.version;
    }

    // Context window from last entry's usage
    if (lastEntry.message?.usage) {
      const usage = lastEntry.message.usage;
      const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      const outputTokens = usage.output_tokens ?? 0;

      result.context_window = {
        context_window_size: null, // determined by model-context.ts in core
        total_input_tokens: inputTokens,
        total_output_tokens: outputTokens,
        current_usage: {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        },
        used_percentage: null,
        remaining_percentage: null,
      };
    }
  }

  return result;
}
