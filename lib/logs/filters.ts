import { CustomFilter, LogEntry, LogLevel, SearchMode } from "@/lib/logs/types"

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildMatcher(pattern: string, mode: SearchMode): RegExp | null {
  const trimmed = pattern.trim()

  if (!trimmed) {
    return null
  }

  try {
    if (mode === "text") {
      return new RegExp(escapeRegExp(trimmed), "i")
    }

    return new RegExp(trimmed, "i")
  } catch {
    if (mode === "regex") {
      return null
    }

    return new RegExp(escapeRegExp(trimmed), "i")
  }
}

function buildCustomMatcher(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i")
  } catch {
    return null
  }
}

function matchesText(entry: LogEntry, pattern: string, mode: SearchMode): boolean {
  const haystack = [entry.message, entry.module, entry.source, entry.thread, entry.code, entry.raw].join(" ")
  const matcher = buildMatcher(pattern, mode)

  if (matcher) {
    return matcher.test(haystack)
  }

  return false
}

export interface FilterEntriesOptions {
  entries: LogEntry[]
  searchTerm: string
  searchMode: SearchMode
  levelFilter: LogLevel[]
  activeFilters: CustomFilter[]
}

export function filterEntries({ entries, searchTerm, searchMode, levelFilter, activeFilters }: FilterEntriesOptions): LogEntry[] {
  return entries.filter((entry) => {
    if (!levelFilter.includes(entry.level)) {
      return false
    }

    if (searchTerm.trim() && !matchesText(entry, searchTerm.trim(), searchMode)) {
      return false
    }

    if (activeFilters.length === 0) {
      return true
    }

    return activeFilters.some((filter) => {
      const haystack = [entry.message, entry.module, entry.source, entry.thread, entry.code, entry.raw].join(" ")
      const matcher = buildCustomMatcher(filter.pattern)

      if (matcher) {
        return matcher.test(haystack)
      }

      return haystack.toLowerCase().includes(filter.pattern.toLowerCase())
    })
  })
}
