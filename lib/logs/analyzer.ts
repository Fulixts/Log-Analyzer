import { LogEntry, LogStats } from "@/lib/logs/types"
import { timestampToMilliseconds } from "@/lib/logs/parser"

function normalizeRejectPattern(message: string): string {
  return message
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/"[^"]*"/g, '"<text>"')
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\[[^\]]{20,}\]/g, "[<payload>]")
    .replace(/\s+/g, " ")
    .trim()
}

function buildRejectPatterns(entries: LogEntry[]) {
  const patternMap = new Map<string, { sample: string; count: number; level: LogEntry["level"]; module: string; source: string; lineIds: number[] }>()

  for (const entry of entries) {
    const interesting =
      entry.level === "ERROR" ||
      entry.level === "WARNING" ||
      /reject|fail|denied|timeout|not found|invalid|exception|abort/i.test(entry.message)

    if (!interesting) {
      continue
    }

    const normalized = normalizeRejectPattern(entry.message || entry.raw)
    const key = `${entry.level}:${entry.module}:${entry.source}:${normalized}`
    const current = patternMap.get(key) ?? {
      sample: entry.message || entry.raw,
      count: 0,
      level: entry.level,
      module: entry.module,
      source: entry.source,
      lineIds: [],
    }

    current.count += 1
    current.lineIds.push(entry.id)
    patternMap.set(key, current)
  }

  return [...patternMap.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 8)
    .map(([key, value]) => ({
      id: key,
      normalized: key.split(":").slice(3).join(":"),
      sample: value.sample.slice(0, 180),
      count: value.count,
      level: value.level,
      module: value.module,
      source: value.source,
      lineIds: value.lineIds.slice(0, 12),
    }))
}

function buildTimeline(entries: LogEntry[]): number[] {
  const bucketCount = 12

  if (entries.length === 0) {
    return Array.from({ length: bucketCount }, () => 0)
  }

  const timestamped = entries
    .map((entry, index) => ({ index, time: timestampToMilliseconds(entry.timestamp) }))
    .filter((item): item is { index: number; time: number } => item.time !== null)

  if (timestamped.length >= 2) {
    const min = timestamped[0].time
    const max = timestamped[timestamped.length - 1].time
    const span = Math.max(1, max - min)
    const buckets = Array.from({ length: bucketCount }, () => 0)

    for (const item of timestamped) {
      const ratio = (item.time - min) / span
      const bucketIndex = Math.min(bucketCount - 1, Math.floor(ratio * bucketCount))
      buckets[bucketIndex] += 1
    }

    return buckets
  }

  const bucketSize = Math.max(1, Math.ceil(entries.length / bucketCount))

  return Array.from({ length: bucketCount }, (_, index) => {
    return entries.slice(index * bucketSize, (index + 1) * bucketSize).length
  })
}

function buildExecutionStats(entries: LogEntry[]) {
  const deltas: number[] = []

  for (let index = 1; index < entries.length; index += 1) {
    const previous = timestampToMilliseconds(entries[index - 1].timestamp)
    const current = timestampToMilliseconds(entries[index].timestamp)

    if (previous === null || current === null || current < previous) {
      continue
    }

    const delta = current - previous

    if (delta <= 60_000) {
      deltas.push(delta)
    }
  }

  if (deltas.length === 0) {
    return { avg: 0, max: 0, min: 0 }
  }

  const total = deltas.reduce((sum, value) => sum + value, 0)

  return {
    avg: Math.round(total / deltas.length),
    max: Math.max(...deltas),
    min: Math.min(...deltas),
  }
}

export function analyzeEntries(entries: LogEntry[]): LogStats {
  const total = entries.length
  const info = entries.filter((entry) => entry.level === "INFO").length
  const debug = entries.filter((entry) => entry.level === "DEBUG").length
  const warning = entries.filter((entry) => entry.level === "WARNING").length
  const error = entries.filter((entry) => entry.level === "ERROR").length
  const unknown = entries.filter((entry) => entry.level === "UNKNOWN").length

  const timeline = buildTimeline(entries)
  const timelineMax = Math.max(1, ...timeline)

  const moduleMap = new Map<string, { errors: number; warnings: number; total: number }>()

  for (const entry of entries) {
    if (!entry.module) {
      continue
    }

    const current = moduleMap.get(entry.module) ?? { errors: 0, warnings: 0, total: 0 }
    current.total += 1

    if (entry.level === "ERROR") {
      current.errors += 1
    }

    if (entry.level === "WARNING") {
      current.warnings += 1
    }

    moduleMap.set(entry.module, current)
  }

  const topModules = [...moduleMap.entries()]
    .sort((left, right) => {
      return right[1].errors - left[1].errors || right[1].warnings - left[1].warnings || right[1].total - left[1].total
    })
    .slice(0, 6)
    .map(([name, counts]) => ({ name, ...counts }))

  const anomalies = entries
    .filter((entry) => entry.level === "ERROR" || entry.level === "WARNING")
    .slice(-8)
    .reverse()
    .map((entry) => ({
      id: `${entry.level}_${entry.id}`,
      message: entry.message.slice(0, 140),
      module: entry.module,
      timestamp: entry.timestamp,
      index: entry.id,
      level: entry.level,
    }))

  const firstTs = entries.find((entry) => entry.timestamp)?.timestamp ?? ""
  const lastTs = [...entries].reverse().find((entry) => entry.timestamp)?.timestamp ?? ""

  return {
    total,
    info,
    debug,
    warning,
    error,
    unknown,
    timeline,
    timelineMax,
    topModules,
    anomalies,
    rejectPatterns: buildRejectPatterns(entries),
    execTime: buildExecutionStats(entries),
    firstTs,
    lastTs,
  }
}
