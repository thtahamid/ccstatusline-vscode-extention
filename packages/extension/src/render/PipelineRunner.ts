import chalk from 'chalk';
import {
  initConfigPath,
  loadSettings,
  updateColorMap,
  preRenderAllWidgets,
  renderStatusLine,
  calculateMaxWidthsFromPreRendered,
  getTokenMetrics,
  getSessionDuration,
  getSpeedMetricsCollection,
  prefetchUsageDataIfNeeded,
  getSkillsMetrics,
  advanceGlobalSeparatorIndex,
  getVisibleText,
  isWidgetSpeedWindowEnabled,
  getWidgetSpeedWindowSeconds,
} from '@ccstatusline/core';
import type { RenderContext, StatusJSON, TokenMetrics, SpeedMetrics, SkillsMetrics } from '@ccstatusline/core';
import { findBestSession } from '../session/SessionDiscovery';
import { buildStatusJSON } from '../session/StatusJSONBuilder';

export interface RenderOutput {
  lines: string[];
  sessionId: string;
  cwd: string;
}

function hasSessionDurationInStatusJson(data: StatusJSON): boolean {
  const durationMs = (data as Record<string, unknown>).cost
    && typeof ((data as Record<string, unknown>).cost as Record<string, unknown>)?.total_duration_ms === 'number';
  return !!durationMs;
}

/**
 * Run the full ccstatusline render pipeline and return ANSI lines.
 * This mirrors renderMultipleLines() from ccstatusline.ts but constructs
 * the StatusJSON from disk data instead of reading from stdin.
 */
export async function runRenderPipeline(
  terminalCols: number,
  workspaceFolders: string[]
): Promise<RenderOutput | null> {
  // Discover active session
  const session = findBestSession(workspaceFolders);
  if (!session) return null;

  // Build StatusJSON from disk
  const statusJSON = buildStatusJSON(session) as StatusJSON;

  // Initialize config and load settings
  initConfigPath();
  const settings = await loadSettings();

  // Force truecolor for xterm.js
  chalk.level = 3;
  updateColorMap();

  const lines = settings.lines;

  // Determine which metrics are needed
  const hasSessionClock = lines.some(line => line.some(item => item.type === 'session-clock'));
  const speedWidgetTypes = new Set(['output-speed', 'input-speed', 'total-speed']);
  const hasSpeedItems = lines.some(line => line.some(item => speedWidgetTypes.has(item.type)));

  const requestedSpeedWindows = new Set<number>();
  for (const line of lines) {
    for (const item of line) {
      if (speedWidgetTypes.has(item.type) && isWidgetSpeedWindowEnabled(item)) {
        requestedSpeedWindows.add(getWidgetSpeedWindowSeconds(item));
      }
    }
  }

  // Fetch metrics
  let tokenMetrics: TokenMetrics | null = null;
  if (statusJSON.transcript_path) {
    tokenMetrics = await getTokenMetrics(statusJSON.transcript_path);
  }

  let sessionDuration: string | null = null;
  if (hasSessionClock && !hasSessionDurationInStatusJson(statusJSON) && statusJSON.transcript_path) {
    sessionDuration = await getSessionDuration(statusJSON.transcript_path);
  }

  const usageData = await prefetchUsageDataIfNeeded(lines, statusJSON);

  let speedMetrics: SpeedMetrics | null = null;
  let windowedSpeedMetrics: Record<string, SpeedMetrics> | null = null;
  if (hasSpeedItems && statusJSON.transcript_path) {
    const collection = await getSpeedMetricsCollection(statusJSON.transcript_path, {
      includeSubagents: true,
      windowSeconds: Array.from(requestedSpeedWindows),
    });
    speedMetrics = collection.sessionAverage;
    windowedSpeedMetrics = collection.windowed;
  }

  let skillsMetrics: SkillsMetrics | null = null;
  if (statusJSON.session_id) {
    skillsMetrics = getSkillsMetrics(statusJSON.session_id);
  }

  // Build render context
  const context: RenderContext = {
    data: statusJSON,
    tokenMetrics,
    speedMetrics,
    windowedSpeedMetrics,
    usageData,
    sessionDuration,
    skillsMetrics,
    terminalWidth: terminalCols,
    isPreview: false,
  };

  // Pre-render all widgets
  const preRenderedLines = preRenderAllWidgets(lines, settings, context);
  const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);

  // Render each line
  const outputLines: string[] = [];
  let globalSeparatorIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineItems = lines[i];
    if (lineItems && lineItems.length > 0) {
      const lineContext: RenderContext = { ...context, lineIndex: i, globalSeparatorIndex };
      const preRenderedWidgets = preRenderedLines[i] ?? [];
      const line = renderStatusLine(lineItems, settings, lineContext, preRenderedWidgets, preCalculatedMaxWidths);

      const strippedLine = getVisibleText(line).trim();
      if (strippedLine.length > 0) {
        // Same post-processing as ccstatusline: NBSP replacement + reset prefix
        let outputLine = line.replace(/ /g, '\u00A0');
        outputLine = '\x1b[0m' + outputLine;
        outputLines.push(outputLine);

        globalSeparatorIndex = advanceGlobalSeparatorIndex(globalSeparatorIndex, lineItems);
      }
    }
  }

  return {
    lines: outputLines,
    sessionId: session.sessionId,
    cwd: session.cwd,
  };
}
