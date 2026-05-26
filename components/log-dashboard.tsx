"use client"

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  EyeOff,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  Highlighter,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Square,
  Star,
  Upload,
  X,
} from "lucide-react"

import { ExplorerDirectoryNode, ExplorerTreeNode, useLogFiles } from "@/hooks/use-log-files"
import { filterEntries } from "@/lib/logs/filters"
import { formatTimestampSlice } from "@/lib/logs/parser"
import { cn } from "@/lib/utils"
import { CustomFilter, LogEntry, LogLevel, SavedSearch, SearchMode } from "@/lib/logs/types"

const LOG_LEVELS: LogLevel[] = ["INFO", "DEBUG", "WARNING", "ERROR", "UNKNOWN"]
const SEARCH_MODES: SearchMode[] = ["smart", "text", "regex"]
const FILTER_STORAGE_KEY = "log-analyzer.custom-filters"
const SEARCH_HISTORY_STORAGE_KEY = "log-analyzer.search-history"
const SAVED_SEARCH_STORAGE_KEY = "log-analyzer.saved-searches"
const INITIAL_VISIBLE_ROWS = Infinity

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatModified(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatDuration(value: number): string {
  if (value <= 0) {
    return "-"
  }

  return `${value} ms`
}

function buildFilter(name: string, pattern: string, color: string): CustomFilter {
  return {
    id: `${Date.now()}-${name}`,
    name: name.trim(),
    pattern: pattern.trim(),
    color,
    createdAt: new Date().toISOString(),
  }
}

function buildSavedSearch(
  name: string,
  query: string,
  mode: SearchMode,
  levels: LogLevel[],
  filterIds: string[],
): SavedSearch {
  return {
    id: `${Date.now()}-${name}`,
    name,
    query,
    mode,
    levels,
    filterIds,
    createdAt: new Date().toISOString(),
  }
}

function getLevelBadgeClass(level: LogLevel): string {
  switch (level) {
    case "ERROR":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    case "WARNING":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200"
    case "INFO":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    case "DEBUG":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-300"
  }
}

function getRowAccent(level: LogLevel): string {
  switch (level) {
    case "ERROR":
      return "border-l-red-500/70"
    case "WARNING":
      return "border-l-amber-500/70"
    case "INFO":
      return "border-l-emerald-500/50"
    case "DEBUG":
      return "border-l-cyan-500/40"
    default:
      return "border-l-zinc-800"
  }
}

function readImportedFilters(file: File): Promise<CustomFilter[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (event) => {
      try {
        const value = String(event.target?.result ?? "[]")
        const parsed = JSON.parse(value) as Partial<CustomFilter>[]
        const filters = parsed
          .filter((item) => item.name && item.pattern && item.color)
          .map((item) => ({
            id: `${Date.now()}-${item.name}`,
            name: String(item.name),
            pattern: String(item.pattern),
            color: String(item.color),
            createdAt: item.createdAt ? String(item.createdAt) : new Date().toISOString(),
          }))

        resolve(filters)
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function readStoredArray<T>(key: string, guard: (value: unknown) => value is T[]): T[] {
  const raw = window.localStorage.getItem(key)

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!guard(parsed)) {
      window.localStorage.removeItem(key)
      return []
    }

    return parsed
  } catch {
    window.localStorage.removeItem(key)
    return []
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isCustomFilterArray(value: unknown): value is CustomFilter[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.pattern === "string" &&
        typeof item.color === "string" &&
        typeof item.createdAt === "string",
    )
  )
}

function isSavedSearchArray(value: unknown): value is SavedSearch[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.query === "string" &&
        typeof item.mode === "string" &&
        Array.isArray(item.levels) &&
        Array.isArray(item.filterIds) &&
        typeof item.createdAt === "string",
    )
  )
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "error" | "warning" | "info" | "success" }) {
  const toneClass =
    tone === "error"
      ? "text-red-300"
      : tone === "warning"
        ? "text-amber-200"
        : tone === "info"
          ? "text-cyan-200"
          : tone === "success"
            ? "text-emerald-200"
            : "text-zinc-100"

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/90 p-3">
      <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">{label}</div>
      <div className={cn("mt-2 text-lg font-semibold", toneClass)}>{value}</div>
    </div>
  )
}

function SectionCard({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-zinc-900 bg-zinc-950/85">
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
      </button>
      {open && <div className="border-t border-zinc-900 px-4 py-4">{children}</div>}
    </section>
  )
}

function TreeNodeView({
  node,
  depth,
  expandedPaths,
  selectedFileId,
  onToggleDirectory,
  onSelectFile,
}: {
  node: ExplorerTreeNode
  depth: number
  expandedPaths: Set<string>
  selectedFileId: string | null
  onToggleDirectory: (path: string) => void
  onSelectFile: (fileId: string) => void
}) {
  const paddingLeft = 12 + depth * 14

  if (node.kind === "directory") {
    const open = expandedPaths.has(node.path)

    return (
      <div>
        <button
          onClick={() => onToggleDirectory(node.path)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-900"
          style={{ paddingLeft }}
        >
          {open ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
          {open ? <FolderOpen className="h-4 w-4 text-cyan-300" /> : <Folder className="h-4 w-4 text-zinc-500" />}
          <span className="truncate">{node.name}</span>
        </button>

        {open && (
          <div>
            {node.children.map((child) => (
              <TreeNodeView
                key={child.id}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                selectedFileId={selectedFileId}
                onToggleDirectory={onToggleDirectory}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const active = selectedFileId === node.fileId

  return (
    <button
      onClick={() => onSelectFile(node.fileId)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-cyan-500/12 text-cyan-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
      )}
      style={{ paddingLeft }}
      title={node.path}
    >
      <FileText className={cn("h-4 w-4 shrink-0", active ? "text-cyan-300" : "text-zinc-500")} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

function LogRow({
  entry,
  selected,
  marked,
  onToggleSelect,
  onToggleMark,
  onHide,
}: {
  entry: LogEntry
  selected: boolean
  marked: boolean
  onToggleSelect: () => void
  onToggleMark: () => void
  onHide: () => void
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[92px_84px_130px_150px_160px_minmax(0,1fr)] gap-3 border-l-2 border-b border-zinc-900 px-4 py-2 text-xs transition-colors hover:bg-zinc-950/60",
        getRowAccent(entry.level),
        selected && "bg-cyan-500/6",
        marked && "shadow-[inset_3px_0_0_0_rgba(250,204,21,0.55)]",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-zinc-500">
        <button onClick={onToggleSelect} className="text-zinc-400 hover:text-cyan-200">
          {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
        </button>
        <button onClick={onToggleMark} className={cn("hover:text-amber-200", marked ? "text-amber-300" : "text-zinc-500")}>
          <Star className="h-4 w-4" fill={marked ? "currentColor" : "none"} />
        </button>
        <button onClick={onHide} className="text-zinc-500 hover:text-red-300">
          <EyeOff className="h-4 w-4" />
        </button>
        <span>{entry.id}</span>
      </div>
      <div>
        <span className={cn("inline-flex rounded border px-2 py-0.5 font-mono text-[10px]", getLevelBadgeClass(entry.level))}>{entry.level}</span>
      </div>
      <div className="truncate font-mono text-zinc-400">{formatTimestampSlice(entry.timestamp) || "-"}</div>
      <div className="truncate text-zinc-300">{entry.module || "-"}</div>
      <div className="truncate text-zinc-500">{entry.source || entry.code || "-"}</div>
      <div className="whitespace-pre-wrap break-words text-zinc-100">{entry.message || entry.raw}</div>
    </div>
  )
}

function collectDirectoryPaths(nodes: ExplorerTreeNode[]): string[] {
  const paths: string[] = []

  for (const node of nodes) {
    if (node.kind === "directory") {
      paths.push(node.path)
    }
  }

  return paths
}

function collectAncestorPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean)
  const paths: string[] = []
  let current = ""

  for (let index = 0; index < Math.max(segments.length - 1, 0); index += 1) {
    current = current ? `${current}/${segments[index]}` : segments[index]
    paths.push(current)
  }

  return paths
}

export default function LogDashboard() {
  const folderInputRef = useRef<HTMLInputElement>(null)
  const filterImportRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { fileTree, files, folderLabel, selectedFile, entries, stats, loading, error, loadFiles, selectFile } = useLogFiles()

  const [searchTerm, setSearchTerm] = useState("")
  const [searchMode, setSearchMode] = useState<SearchMode>("smart")
  const [showSearchHistory, setShowSearchHistory] = useState(false)
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [levelFilter, setLevelFilter] = useState<LogLevel[]>([...LOG_LEVELS])
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS)
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([])
  const [activeFilterIds, setActiveFilterIds] = useState<string[]>([])
  const [newFilterName, setNewFilterName] = useState("")
  const [newFilterPattern, setNewFilterPattern] = useState("")
  const [newFilterColor, setNewFilterColor] = useState("#22d3ee")
  const [selectedLineIds, setSelectedLineIds] = useState<number[]>([])
  const [markedLineIds, setMarkedLineIds] = useState<number[]>([])
  const [hiddenLineIds, setHiddenLineIds] = useState<number[]>([])
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [showOnlyMarked, setShowOnlyMarked] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [openSections, setOpenSections] = useState<string[]>(["summary", "patterns"])

  useEffect(() => {
    const input = folderInputRef.current

    if (!input) {
      return
    }

    input.setAttribute("webkitdirectory", "")
    input.setAttribute("directory", "")
  }, [])

  useEffect(() => {
    setCustomFilters(readStoredArray(FILTER_STORAGE_KEY, isCustomFilterArray))
    setSearchHistory(readStoredArray(SEARCH_HISTORY_STORAGE_KEY, isStringArray))
    setSavedSearches(readStoredArray(SAVED_SEARCH_STORAGE_KEY, isSavedSearchArray))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(customFilters))
  }, [customFilters])

  useEffect(() => {
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(searchHistory))
  }, [searchHistory])

  useEffect(() => {
    window.localStorage.setItem(SAVED_SEARCH_STORAGE_KEY, JSON.stringify(savedSearches))
  }, [savedSearches])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ROWS)
  }, [selectedFile?.id, searchTerm, searchMode, levelFilter, activeFilterIds, hiddenLineIds, showOnlySelected, showOnlyMarked])

  useEffect(() => {
    setSelectedLineIds([])
    setMarkedLineIds([])
    setHiddenLineIds([])
    setShowOnlyMarked(false)
    setShowOnlySelected(false)
  }, [selectedFile?.id])

  useEffect(() => {
    if (!actionMessage) {
      return
    }

    const timeout = window.setTimeout(() => setActionMessage(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [actionMessage])

  useEffect(() => {
    if (fileTree.length === 0) {
      setExpandedPaths(new Set())
      return
    }

    const next = new Set<string>(collectDirectoryPaths(fileTree))

    if (selectedFile) {
      for (const path of collectAncestorPaths(selectedFile.relativePath)) {
        next.add(path)
      }
    }

    setExpandedPaths(next)
  }, [fileTree, selectedFile?.id])

  const activeFilters = useMemo(() => {
    return customFilters.filter((filter) => activeFilterIds.includes(filter.id))
  }, [activeFilterIds, customFilters])

  const baseFilteredEntries = useMemo(() => {
    return filterEntries({
      entries,
      searchTerm,
      searchMode,
      levelFilter,
      activeFilters,
    })
  }, [activeFilters, entries, levelFilter, searchMode, searchTerm])

  const visibleEntries = useMemo(() => {
    return baseFilteredEntries.filter((entry) => {
      if (hiddenLineIds.includes(entry.id)) {
        return false
      }

      if (showOnlySelected && !selectedLineIds.includes(entry.id)) {
        return false
      }

      if (showOnlyMarked && !markedLineIds.includes(entry.id)) {
        return false
      }

      return true
    })
  }, [baseFilteredEntries, hiddenLineIds, markedLineIds, selectedLineIds, showOnlyMarked, showOnlySelected])

  const selectedVisibleEntries = useMemo(() => {
    return visibleEntries.filter((entry) => selectedLineIds.includes(entry.id))
  }, [selectedLineIds, visibleEntries])

  async function handleFolderChange(event: ChangeEvent<HTMLInputElement>) {
    const incomingFiles = Array.from(event.target.files ?? [])
    await loadFiles(incomingFiles)
    event.target.value = ""
    setExplorerOpen(true)
  }

  async function handleImportFilters(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const imported = await readImportedFilters(file)
      const nextByName = new Map(customFilters.map((filter) => [filter.name, filter]))

      for (const filter of imported) {
        nextByName.set(filter.name, filter)
      }

      setCustomFilters([...nextByName.values()])
      setActionMessage("Filtros importados.")
    } finally {
      event.target.value = ""
    }
  }

  function toggleSection(section: string) {
    setOpenSections((current) => {
      return current.includes(section) ? current.filter((item) => item !== section) : [...current, section]
    })
  }

  function toggleDirectory(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }

  function downloadTextFile(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function downloadJsonFile(filename: string, content: unknown) {
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function copyText(content: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(content)
      setActionMessage(successMessage)
    } catch {
      setActionMessage("Não foi possível copiar para a área de transferência.")
    }
  }

  function handleExportFilters() {
    downloadJsonFile(`log-filters-${new Date().toISOString().slice(0, 10)}.json`, customFilters)
  }

  function toggleLevel(level: LogLevel) {
    setLevelFilter((current) => {
      return current.includes(level) ? current.filter((item) => item !== level) : [...current, level]
    })
  }

  function addCustomFilter() {
    if (!newFilterName.trim() || !newFilterPattern.trim()) {
      return
    }

    const next = buildFilter(newFilterName, newFilterPattern, newFilterColor)
    setCustomFilters((current) => [...current, next])
    setActiveFilterIds((current) => [...current, next.id])
    setNewFilterName("")
    setNewFilterPattern("")
    setNewFilterColor("#22d3ee")
    setActionMessage("Filtro adicionado.")
  }

  function removeCustomFilter(filterId: string) {
    setCustomFilters((current) => current.filter((filter) => filter.id !== filterId))
    setActiveFilterIds((current) => current.filter((id) => id !== filterId))
  }

  function toggleCustomFilter(filterId: string) {
    setActiveFilterIds((current) => {
      return current.includes(filterId) ? current.filter((id) => id !== filterId) : [...current, filterId]
    })
  }

  function addSearchToHistory(query: string) {
    const trimmed = query.trim()

    if (!trimmed) {
      return
    }

    setSearchHistory((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, 12))
  }

  function saveCurrentSearch() {
    if (!searchTerm.trim()) {
      setActionMessage("Digite uma busca antes de salvar.")
      return
    }

    const name = searchTerm.trim().slice(0, 36)
    const saved = buildSavedSearch(name, searchTerm.trim(), searchMode, levelFilter, activeFilterIds)
    setSavedSearches((current) => [saved, ...current.filter((item) => item.name !== saved.name)].slice(0, 12))
    addSearchToHistory(searchTerm)
    setActionMessage("Busca salva.")
  }

  function applySavedSearch(savedSearch: SavedSearch) {
    setSearchTerm(savedSearch.query)
    setSearchMode(savedSearch.mode)
    setLevelFilter(savedSearch.levels)
    setActiveFilterIds(savedSearch.filterIds)
    addSearchToHistory(savedSearch.query)
    setShowSearchHistory(false)
    setActionMessage(`Busca aplicada: ${savedSearch.name}`)
  }

  function removeSavedSearch(id: string) {
    setSavedSearches((current) => current.filter((item) => item.id !== id))
  }

  function toggleLineSelection(lineId: number) {
    setSelectedLineIds((current) => {
      return current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]
    })
  }

  function toggleLineMark(lineId: number) {
    setMarkedLineIds((current) => {
      return current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]
    })
  }

  function hideLine(lineId: number) {
    setHiddenLineIds((current) => (current.includes(lineId) ? current : [...current, lineId]))
    setSelectedLineIds((current) => current.filter((id) => id !== lineId))
  }

  function selectAllVisible() {
    setSelectedLineIds(visibleEntries.map((entry) => entry.id))
  }

  function clearSelection() {
    setSelectedLineIds([])
  }

  function markSelectedLines() {
    if (selectedLineIds.length === 0) {
      return
    }

    setMarkedLineIds((current) => [...new Set([...current, ...selectedLineIds])])
    setActionMessage("Linhas selecionadas marcadas.")
  }

  function hideSelectedLines() {
    if (selectedLineIds.length === 0) {
      return
    }

    setHiddenLineIds((current) => [...new Set([...current, ...selectedLineIds])])
    setSelectedLineIds([])
    setActionMessage("Linhas selecionadas ocultadas.")
  }

  function clearHiddenLines() {
    setHiddenLineIds([])
    setActionMessage("Linhas ocultas restauradas.")
  }

  function clearAllViewControls() {
    setSearchTerm("")
    setSearchMode("smart")
    setLevelFilter([...LOG_LEVELS])
    setActiveFilterIds([])
    setHiddenLineIds([])
    setShowOnlyMarked(false)
    setShowOnlySelected(false)
    setActionMessage("Visão resetada.")
  }

  function buildExportPayload(targetEntries: LogEntry[]) {
    return {
      file: selectedFile?.relativePath ?? null,
      folder: folderLabel,
      searchTerm,
      searchMode,
      levelFilter,
      activeFilters: activeFilters.map((filter) => ({ name: filter.name, pattern: filter.pattern })),
      lines: targetEntries.map((entry) => ({
        id: entry.id,
        level: entry.level,
        timestamp: entry.timestamp,
        module: entry.module,
        source: entry.source,
        message: entry.message,
        raw: entry.raw,
      })),
    }
  }

  function exportSelectedAsText() {
    if (selectedVisibleEntries.length === 0) {
      setActionMessage("Nenhuma linha selecionada para exportar.")
      return
    }

    downloadTextFile(
      `${selectedFile?.name ?? "selected-lines"}-selected.txt`,
      selectedVisibleEntries.map((entry) => entry.raw).join("\n\n"),
    )
  }

  function exportSelectedAsJson() {
    if (selectedVisibleEntries.length === 0) {
      setActionMessage("Nenhuma linha selecionada para exportar.")
      return
    }

    downloadJsonFile(`${selectedFile?.name ?? "selected-lines"}-selected.json`, buildExportPayload(selectedVisibleEntries))
  }

  function exportVisibleAsText() {
    if (visibleEntries.length === 0) {
      setActionMessage("Nenhuma linha visível para exportar.")
      return
    }

    downloadTextFile(`${selectedFile?.name ?? "visible-lines"}-visible.txt`, visibleEntries.map((entry) => entry.raw).join("\n\n"))
  }

  function exportVisibleAsJson() {
    if (visibleEntries.length === 0) {
      setActionMessage("Nenhuma linha visível para exportar.")
      return
    }

    downloadJsonFile(`${selectedFile?.name ?? "visible-lines"}-visible.json`, buildExportPayload(visibleEntries))
  }

  async function copySelectedForAi() {
    if (selectedVisibleEntries.length === 0) {
      setActionMessage("Nenhuma linha selecionada para IA.")
      return
    }

    await copyText(JSON.stringify(buildExportPayload(selectedVisibleEntries), null, 2), "Payload para IA copiado.")
  }

  function usePatternAsSearch(pattern: string) {
    setSearchTerm(pattern)
    setSearchMode("text")
    addSearchToHistory(pattern)
    setInspectorOpen(false)
  }

  return (
    <div className="h-screen overflow-hidden bg-[#070709] text-zinc-100">
      <input ref={folderInputRef} type="file" multiple webkitdirectory="" className="hidden" onChange={handleFolderChange} />
      <input ref={filterImportRef} type="file" accept=".json" className="hidden" onChange={handleImportFilters} />

      <div className="fixed inset-0 opacity-25" style={{ backgroundImage: "linear-gradient(to right, #101014 1px, transparent 1px), linear-gradient(to bottom, #101014 1px, transparent 1px)", backgroundSize: "36px 36px" }} />

      <div className="relative z-10 flex h-full flex-col">
        <header className="border-b border-zinc-900 bg-zinc-950/90 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-300">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">Local Log Analyzer</div>
                <h1 className="text-lg font-semibold text-zinc-100">McDonald&apos;s PXT Log Workspace</h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => setExplorerOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900">
                {explorerOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                explorer
              </button>
              <button onClick={() => setInspectorOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900">
                {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                detalhes
              </button>
              <button onClick={() => folderInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20">
                <FolderOpen className="h-4 w-4" />
                Selecionar pasta
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-900 px-4 py-2 text-xs text-zinc-500">
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono">pasta: {folderLabel}</span>
            {selectedFile && <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono">arquivo: {selectedFile.relativePath}</span>}
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono">visíveis: {visibleEntries.length}</span>
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono">selecionadas: {selectedVisibleEntries.length}</span>
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono">ocultas: {hiddenLineIds.length}</span>
          </div>
        </header>

        {actionMessage && (
          <div className="px-4 pt-3">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">{actionMessage}</div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-4 px-4 py-4">
          {explorerOpen && (
            <aside className="flex w-[320px] min-w-[280px] flex-col overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950/90">
              <div className="border-b border-zinc-900 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Explorer</div>
                <div className="mt-1 text-sm text-zinc-300">Árvore de pastas e logs</div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
                {fileTree.length === 0 ? (
                  <button onClick={() => folderInputRef.current?.click()} className="mx-2 w-[calc(100%-16px)] rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-8 text-center transition-colors hover:border-zinc-700 hover:bg-zinc-950">
                    <Upload className="mx-auto h-5 w-5 text-zinc-600" />
                    <div className="mt-3 text-sm text-zinc-300">Selecione uma pasta com logs.</div>
                    <div className="mt-2 text-xs text-zinc-500">A estrutura será exibida como uma árvore expansível.</div>
                  </button>
                ) : (
                  fileTree.map((node) => (
                    <TreeNodeView
                      key={node.id}
                      node={node}
                      depth={0}
                      expandedPaths={expandedPaths}
                      selectedFileId={selectedFile?.id ?? null}
                      onToggleDirectory={toggleDirectory}
                      onSelectFile={(fileId) => void selectFile(fileId)}
                    />
                  ))
                )}
              </div>

              <div className="border-t border-zinc-900 px-4 py-3 text-xs text-zinc-500">
                {files.length.toLocaleString("pt-BR")} arquivo(s) .log encontrado(s)
              </div>
            </aside>
          )}

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950/90">
            <div className="border-b border-zinc-900 px-4 py-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="relative flex-1">
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <Search className="h-4 w-4 text-zinc-500" />
                    <input
                      ref={searchInputRef}
                      value={searchTerm}
                      onFocus={() => setShowSearchHistory(true)}
                      onBlur={() => window.setTimeout(() => setShowSearchHistory(false), 180)}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          addSearchToHistory(searchTerm)
                          setShowSearchHistory(false)
                        }
                      }}
                      placeholder="Buscar no log por texto, regex, módulo, origem, mensagem..."
                      className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                    />
                    {searchTerm && (
                      <button onClick={() => setSearchTerm("")} className="text-zinc-500 hover:text-zinc-200">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {showSearchHistory && searchHistory.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl">
                      <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Últimas buscas</div>
                      <div className="space-y-1">
                        {searchHistory.map((item) => (
                          <button
                            key={item}
                            onClick={() => {
                              setSearchTerm(item)
                              setShowSearchHistory(false)
                            }}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-900"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {SEARCH_MODES.map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSearchMode(mode)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-mono uppercase transition-colors",
                        searchMode === mode ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" : "border-zinc-800 bg-zinc-950 text-zinc-500",
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                  <button onClick={saveCurrentSearch} className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900">
                    <Save className="h-3.5 w-3.5" />
                    salvar busca
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {LOG_LEVELS.map((level) => {
                  const active = levelFilter.includes(level)

                  return (
                    <button
                      key={level}
                      onClick={() => toggleLevel(level)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-mono transition-colors",
                        active ? getLevelBadgeClass(level) : "border-zinc-800 bg-zinc-950 text-zinc-500",
                      )}
                    >
                      {level}
                    </button>
                  )
                })}

                <button onClick={clearAllViewControls} className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-100">
                  limpar visão
                </button>
                <button onClick={() => setShowOnlySelected((current) => !current)} className={cn("rounded-full border px-3 py-1.5 text-xs", showOnlySelected ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" : "border-zinc-800 bg-zinc-950 text-zinc-400")}>só selecionadas</button>
                <button onClick={() => setShowOnlyMarked((current) => !current)} className={cn("rounded-full border px-3 py-1.5 text-xs", showOnlyMarked ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-zinc-800 bg-zinc-950 text-zinc-400")}>só marcadas</button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-900 pt-3">
                <button onClick={selectAllVisible} disabled={visibleEntries.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                  <CheckSquare className="h-4 w-4" />
                  selecionar visíveis
                </button>
                <button onClick={clearSelection} disabled={selectedLineIds.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                  <Square className="h-4 w-4" />
                  limpar seleção
                </button>
                <button onClick={markSelectedLines} disabled={selectedLineIds.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-amber-500/40 hover:text-amber-200 disabled:opacity-50">
                  <Star className="h-4 w-4" />
                  marcar
                </button>
                <button onClick={hideSelectedLines} disabled={selectedLineIds.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-red-500/40 hover:text-red-200 disabled:opacity-50">
                  <EyeOff className="h-4 w-4" />
                  ocultar
                </button>
                <button onClick={clearHiddenLines} disabled={hiddenLineIds.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                  <RefreshCw className="h-4 w-4" />
                  restaurar ocultas
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 px-4 py-4">
              {!selectedFile ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 text-center">
                  <div className="max-w-md px-6">
                    <FolderOpen className="mx-auto h-8 w-8 text-cyan-400" />
                    <div className="mt-4 text-lg font-medium text-zinc-100">Selecione uma pasta e depois um arquivo na árvore</div>
                    <div className="mt-2 text-sm text-zinc-500">O foco aqui é o log: a maior parte da tela agora fica reservada para leitura, rolagem e seleção do arquivo.</div>
                  </div>
                </div>
              ) : loading ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-950/50">
                  <div className="text-center">
                    <RefreshCw className="mx-auto h-6 w-6 animate-spin text-cyan-300" />
                    <div className="mt-3 text-sm text-zinc-300">Carregando {selectedFile.name}...</div>
                  </div>
                </div>
              ) : error ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5 px-6 text-center">
                  <div>
                    <AlertTriangle className="mx-auto h-6 w-6 text-red-300" />
                    <div className="mt-3 text-sm text-red-200">{error}</div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-900 bg-black/30">
                  <div className="grid grid-cols-[92px_84px_130px_150px_160px_minmax(0,1fr)] gap-3 border-b border-zinc-900 bg-zinc-950/90 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    <div>Ações / Linha</div>
                    <div>Nível</div>
                    <div>Tempo</div>
                    <div>Módulo</div>
                    <div>Origem</div>
                    <div>Mensagem</div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto">
                    {visibleEntries.length === 0 ? (
                      <div className="px-4 py-12 text-center text-sm text-zinc-500">Nenhuma linha corresponde aos filtros atuais.</div>
                    ) : (
                      visibleEntries.slice(0, visibleCount).map((entry) => (
                        <LogRow
                          key={entry.id}
                          entry={entry}
                          selected={selectedLineIds.includes(entry.id)}
                          marked={markedLineIds.includes(entry.id)}
                          onToggleSelect={() => toggleLineSelection(entry.id)}
                          onToggleMark={() => toggleLineMark(entry.id)}
                          onHide={() => hideLine(entry.id)}
                        />
                      ))
                    )}
                  </div>

                  {visibleCount < visibleEntries.length && (
                    <div className="border-t border-zinc-900 p-4 text-center">
                      <button onClick={() => setVisibleCount((current) => current + INITIAL_VISIBLE_ROWS)} className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900">
                        Carregar mais linhas ({Math.max(visibleEntries.length - visibleCount, 0).toLocaleString("pt-BR")} restantes)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {inspectorOpen && (
            <aside className="flex w-[360px] min-w-[340px] flex-col gap-3 overflow-auto rounded-2xl border border-zinc-900 bg-zinc-950/90 p-3">
              <SectionCard title="Resumo" open={openSections.includes("summary")} onToggle={() => toggleSection("summary")}>
                {selectedFile ? (
                  <div className="space-y-3 text-sm text-zinc-300">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Arquivo selecionado</div>
                      <div className="mt-2 break-all font-medium text-zinc-100">{selectedFile.relativePath}</div>
                      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                        <span>{formatFileSize(selectedFile.size)}</span>
                        <span>{formatModified(selectedFile.modified)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <MetricCard label="Total" value={stats?.total ?? 0} />
                      <MetricCard label="Unknown" value={stats?.unknown ?? 0} />
                      <MetricCard label="Errors" value={stats?.error ?? 0} tone="error" />
                      <MetricCard label="Warnings" value={stats?.warning ?? 0} tone="warning" />
                      <MetricCard label="Visíveis" value={visibleEntries.length} tone="info" />
                      <MetricCard label="Seleção" value={selectedVisibleEntries.length} tone="success" />
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Janela temporal</div>
                      <div className="mt-3 space-y-2 font-mono text-xs text-zinc-300">
                        <div className="flex items-center justify-between gap-3"><span className="text-zinc-500">Início</span><span>{stats?.firstTs ? formatTimestampSlice(stats.firstTs) : "-"}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-zinc-500">Fim</span><span>{stats?.lastTs ? formatTimestampSlice(stats.lastTs) : "-"}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-zinc-500">Delta máx.</span><span>{formatDuration(stats?.execTime.max ?? 0)}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-zinc-500">Delta mín.</span><span>{formatDuration(stats?.execTime.min ?? 0)}</span></div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">Nenhum arquivo carregado.</div>
                )}
              </SectionCard>

              <SectionCard title="Filtros" open={openSections.includes("filters")} onToggle={() => toggleSection("filters")}>
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input value={newFilterName} onChange={(event) => setNewFilterName(event.target.value)} placeholder="Nome" className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50" />
                    <input value={newFilterPattern} onChange={(event) => setNewFilterPattern(event.target.value)} placeholder="Regex ou texto" className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50" />
                    <input type="color" value={newFilterColor} onChange={(event) => setNewFilterColor(event.target.value)} className="h-10 w-12 rounded-lg border border-zinc-800 bg-zinc-950 p-1" />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={addCustomFilter} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20">
                      <Filter className="h-4 w-4" />
                      Adicionar
                    </button>
                    <button onClick={() => filterImportRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900">
                      <Upload className="h-4 w-4" />
                      Importar
                    </button>
                    <button onClick={handleExportFilters} disabled={customFilters.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                      <Download className="h-4 w-4" />
                      Exportar
                    </button>
                  </div>

                  <div className="space-y-2">
                    {customFilters.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-xs text-zinc-500">Nenhum filtro salvo.</div>
                    ) : (
                      customFilters.map((filter) => {
                        const active = activeFilterIds.includes(filter.id)

                        return (
                          <div key={filter.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                            <button onClick={() => toggleCustomFilter(filter.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: filter.color }} />
                              <div className="min-w-0">
                                <div className={cn("truncate text-sm", active ? "text-zinc-100" : "text-zinc-400")}>{filter.name}</div>
                                <div className="truncate font-mono text-[11px] text-zinc-500">{filter.pattern}</div>
                              </div>
                            </button>
                            <button onClick={() => removeCustomFilter(filter.id)} className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:border-red-500/40 hover:text-red-300">
                              remover
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Buscas salvas" open={openSections.includes("searches")} onToggle={() => toggleSection("searches")}>
                <div className="space-y-3">
                  <button onClick={saveCurrentSearch} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900">
                    <Save className="h-4 w-4" />
                    salvar busca atual
                  </button>

                  <div className="space-y-2">
                    {savedSearches.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-xs text-zinc-500">Nenhuma busca salva.</div>
                    ) : (
                      savedSearches.map((savedSearch) => (
                        <div key={savedSearch.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                          <button onClick={() => applySavedSearch(savedSearch)} className="min-w-0 flex-1 text-left">
                            <div className="truncate text-sm text-zinc-100">{savedSearch.name}</div>
                            <div className="truncate font-mono text-[11px] text-zinc-500">{savedSearch.query}</div>
                          </button>
                          <button onClick={() => removeSavedSearch(savedSearch.id)} className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:border-red-500/40 hover:text-red-300">
                            remover
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Módulos com mais impacto" open={openSections.includes("modules")} onToggle={() => toggleSection("modules")}>
                <div className="space-y-2">
                  {stats?.topModules.length ? (
                    stats.topModules.map((module) => (
                      <button key={module.name} onClick={() => usePatternAsSearch(module.name)} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left hover:border-cyan-500/30 hover:bg-zinc-900">
                        <div className="truncate text-sm font-medium text-zinc-100">{module.name}</div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-500">
                          <div><span className="text-zinc-400">total</span><div className="mt-1 text-zinc-100">{module.total}</div></div>
                          <div><span className="text-zinc-400">warn</span><div className="mt-1 text-amber-200">{module.warnings}</div></div>
                          <div><span className="text-zinc-400">error</span><div className="mt-1 text-red-300">{module.errors}</div></div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-sm text-zinc-500">Sem módulos suficientes para ranking.</div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Padrões de reject / falha" open={openSections.includes("patterns")} onToggle={() => toggleSection("patterns")}>
                <div className="space-y-2">
                  {stats?.rejectPatterns.length ? (
                    stats.rejectPatterns.map((pattern) => (
                      <button key={pattern.id} onClick={() => usePatternAsSearch(pattern.sample)} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left hover:border-cyan-500/30 hover:bg-zinc-900">
                        <div className="flex items-center justify-between gap-3">
                          <span className={cn("rounded border px-2 py-0.5 font-mono text-[10px]", getLevelBadgeClass(pattern.level))}>{pattern.level}</span>
                          <span className="font-mono text-[11px] text-zinc-500">{pattern.count}x</span>
                        </div>
                        <div className="mt-2 line-clamp-3 text-sm text-zinc-100">{pattern.sample}</div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                          <span className="truncate">{pattern.module || pattern.source || "sem origem"}</span>
                          <span>linhas {pattern.lineIds.slice(0, 3).join(", ")}</span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-sm text-zinc-500">Nenhum padrão recorrente encontrado.</div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Alertas recentes" open={openSections.includes("alerts")} onToggle={() => toggleSection("alerts")}>
                <div className="space-y-2">
                  {stats?.anomalies.length ? (
                    stats.anomalies.map((anomaly) => (
                      <button key={anomaly.id} onClick={() => setSearchTerm(anomaly.message)} className={cn("w-full rounded-lg border p-3 text-left", anomaly.level === "ERROR" ? "border-red-500/20 bg-red-500/5" : "border-amber-500/20 bg-amber-500/5")}>
                        <div className="flex items-center justify-between gap-3">
                          <span className={cn("rounded border px-2 py-0.5 font-mono text-[10px]", getLevelBadgeClass(anomaly.level))}>{anomaly.level}</span>
                          <span className="font-mono text-[11px] text-zinc-500">linha {anomaly.index}</span>
                        </div>
                        <div className="mt-2 text-sm text-zinc-100">{anomaly.message}</div>
                        <div className="mt-2 text-[11px] text-zinc-500">{anomaly.module || formatTimestampSlice(anomaly.timestamp)}</div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-sm text-zinc-500">Nenhum warning/error recente.</div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Exportação / IA" open={openSections.includes("exports")} onToggle={() => toggleSection("exports")}>
                <div className="grid gap-2">
                  <button onClick={exportSelectedAsText} disabled={selectedVisibleEntries.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                    <Download className="h-4 w-4" />
                    exportar seleção txt
                  </button>
                  <button onClick={exportSelectedAsJson} disabled={selectedVisibleEntries.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                    <Save className="h-4 w-4" />
                    exportar seleção json
                  </button>
                  <button onClick={exportVisibleAsText} disabled={visibleEntries.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                    <FileText className="h-4 w-4" />
                    salvar visíveis txt
                  </button>
                  <button onClick={exportVisibleAsJson} disabled={visibleEntries.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                    <Bookmark className="h-4 w-4" />
                    salvar visíveis json
                  </button>
                  <button onClick={copySelectedForAi} disabled={selectedVisibleEntries.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
                    <Sparkles className="h-4 w-4" />
                    copiar payload IA
                  </button>
                  <button onClick={() => copyText(visibleEntries.map((entry) => `${entry.id}\t${entry.message || entry.raw}`).join("\n"), "Linhas visíveis copiadas.")} disabled={visibleEntries.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                    <Copy className="h-4 w-4" />
                    copiar linhas visíveis
                  </button>
                  <button onClick={() => copyText(markedLineIds.join(", "), "IDs marcados copiados.")} disabled={markedLineIds.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50">
                    <Highlighter className="h-4 w-4" />
                    copiar ids marcados
                  </button>
                </div>
              </SectionCard>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
