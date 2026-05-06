export type LogLevel = "INFO" | "DEBUG" | "WARNING" | "ERROR" | "UNKNOWN"

export type SearchMode = "smart" | "text" | "regex"

export interface LogEntry {
  id: number
  level: LogLevel
  timestamp: string
  thread: string
  module: string
  code: string
  source: string
  message: string
  raw: string
}

export interface ModuleSummary {
  name: string
  errors: number
  warnings: number
  total: number
}

export interface LogAnomaly {
  id: string
  message: string
  module: string
  timestamp: string
  index: number
  level: LogLevel
}

export interface RejectPatternSummary {
  id: string
  normalized: string
  sample: string
  count: number
  level: LogLevel
  module: string
  source: string
  lineIds: number[]
}

export interface ExecutionTimeStats {
  avg: number
  max: number
  min: number
}

export interface LogStats {
  total: number
  info: number
  debug: number
  warning: number
  error: number
  unknown: number
  timeline: number[]
  timelineMax: number
  topModules: ModuleSummary[]
  anomalies: LogAnomaly[]
  rejectPatterns: RejectPatternSummary[]
  execTime: ExecutionTimeStats
  firstTs: string
  lastTs: string
}

export interface CustomFilter {
  id: string
  name: string
  pattern: string
  color: string
  createdAt: string
}

export interface SavedSearch {
  id: string
  name: string
  query: string
  mode: SearchMode
  levels: LogLevel[]
  filterIds: string[]
  createdAt: string
}
