// Library exports for the VS Code extension
// Render pipeline
export {
    preRenderAllWidgets,
    renderStatusLine,
    calculateMaxWidthsFromPreRendered,
    formatTokens
} from './utils/renderer';

export {
    loadSettings,
    saveSettings,
    initConfigPath
} from './utils/config';

export { updateColorMap } from './utils/colors';

// Data layer
export {
    getTokenMetrics,
    getSessionDuration,
    getSpeedMetricsCollection
} from './utils/jsonl';

export { prefetchUsageDataIfNeeded } from './utils/usage-prefetch';
export { getSkillsMetrics } from './utils/skills';
export { advanceGlobalSeparatorIndex } from './utils/separator-index';
export { getVisibleText } from './utils/ansi';
export {
    isWidgetSpeedWindowEnabled,
    getWidgetSpeedWindowSeconds
} from './utils/speed-window';

// Types
export type { RenderContext, RenderUsageData } from './types/RenderContext';
export type { StatusJSON } from './types/StatusJSON';
export { StatusJSONSchema } from './types/StatusJSON';
export type { Settings } from './types/Settings';
export type { TokenMetrics, TokenUsage, TranscriptLine } from './types/TokenMetrics';
export type { SpeedMetrics } from './types/SpeedMetrics';
export type { SkillsMetrics } from './types/SkillsMetrics';
export type { BlockMetrics } from './types/BlockMetrics';
export type { WidgetItem, WidgetItemType } from './types/Widget';
export type { FlexMode } from './types/FlexMode';
export type { PowerlineConfig } from './types/PowerlineConfig';
