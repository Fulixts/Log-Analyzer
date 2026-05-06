import { LogEntry, LogLevel } from "@/lib/logs/types"

const KNOWN_LEVELS: LogLevel[] = ["INFO", "DEBUG", "WARNING", "ERROR"]
const ENTRY_START_REGEX = /^(INFO|DEBUG|WARNING|ERROR)\t/

function isKnownLevel(level: string): level is Exclude<LogLevel, "UNKNOWN"> {
  return KNOWN_LEVELS.includes(level as Exclude<LogLevel, "UNKNOWN">)
}

function parseStructuredEntry(raw: string, index: number): LogEntry {
  const parts = raw.split("\t")
  const levelCandidate = parts[0]?.trim() ?? ""

  if (isKnownLevel(levelCandidate) && parts.length >= 7) {
    return {
      id: index + 1,
      level: levelCandidate,
      timestamp: parts[1]?.trim() ?? "",
      thread: parts[2]?.trim() ?? "",
      module: parts[3]?.trim() ?? "",
      code: parts[4]?.trim() ?? "",
      source: parts[5]?.trim() ?? "",
      message: parts.slice(6).join("\t").trim(),
      raw,
    }
  }

  return {
    id: index + 1,
    level: "UNKNOWN",
    timestamp: "",
    thread: "",
    module: "",
    code: "",
    source: "",
    message: raw.trim(),
    raw,
  }
}

export function parseLogText(text: string): LogEntry[] {
  const normalizedLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const entries: string[] = []
  let current = ""

  for (const line of normalizedLines) {
    if (!line.trim()) {
      continue
    }

    if (ENTRY_START_REGEX.test(line)) {
      if (current) {
        entries.push(current)
      }

      current = line
      continue
    }

    current = current ? `${current}\n${line}` : line
  }

  if (current) {
    entries.push(current)
  }

  return entries.map((entry, index) => parseStructuredEntry(entry, index))
}

export function timestampToMilliseconds(timestamp: string): number | null {
  const match = timestamp.match(/T(\d{2})(\d{2})(\d{2})\.(\d{3})/)

  if (!match) {
    return null
  }

  const [, hours, minutes, seconds, milliseconds] = match

  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  )
}

export function formatTimestampSlice(timestamp: string): string {
  const match = timestamp.match(/T(\d{6}\.\d{3})/)
  return match ? match[1] : timestamp
}
