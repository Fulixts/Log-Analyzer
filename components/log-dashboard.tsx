"use client"

import { useEffect, useState, useRef } from "react"

interface LogFile {
  name: string
  size: number
  modified: string
}

interface LogEntry {
  id: number
  level: string
  timestamp: string
  thread: string
  module: string
  code: string
  source: string
  message: string
  raw: string
}

interface LogStats {
  total: number
  info: number
  debug: number
  warning: number
  error: number
  timeline: number[]
  timelineMax: number
  topModules: { name: string; errors: number; warnings: number; total: number }[]
  anomalies: { id: string; message: string; module: string; timestamp: string; index: number }[]
  execTime: { avg: number; max: number; min: number }
  firstTs: string
  lastTs: string
}

export default function LogDashboard() {
  const [files, setFiles] = useState<LogFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filteredEntries, setFilteredEntries] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [levelFilter, setLevelFilter] = useState<string[]>(["INFO", "DEBUG", "WARNING", "ERROR"])
  const [visibleCount, setVisibleCount] = useState(100)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [statsOpen, setStatsOpen] = useState(true)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const [sliderValue, setSliderValue] = useState(0)
  
  // Search history and filters
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [showSearchHistory, setShowSearchHistory] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showFilterEditor, setShowFilterEditor] = useState(false)
  const [showImportConflict, setShowImportConflict] = useState(false)
  const [importConflicts, setImportConflicts] = useState<{existing: CustomFilter, incoming: CustomFilter}[]>([])
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0)
  const [applyToAll, setApplyToAll] = useState(false)
  const filterInputRef = useRef<HTMLInputElement>(null)
  
  // Custom filters
  interface CustomFilter {
    id: string
    name: string
    regex: string
    color: string
    createdAt: string
  }
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('logAnalyzerFilters')
      return saved ? JSON.parse(saved) : []
    }
    return []
  })
  const [newFilterName, setNewFilterName] = useState("")
  const [newFilterRegex, setNewFilterRegex] = useState("")
  const [newFilterColor, setNewFilterColor] = useState("#00F0FF")
  const [editingFilter, setEditingFilter] = useState<CustomFilter | null>(null)
  const [activeFilterIds, setActiveFilterIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchFiles()
  }, [])

  // Auto-load with Intersection Observer
  useEffect(() => {
    const currentRef = loadMoreRef.current
    if (!currentRef) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => {
            if (prev < filteredEntries.length) {
              return prev + 100
            }
            return prev
          })
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    )

    observer.observe(currentRef)

    return () => {
      observer.disconnect()
    }
  }, [filteredEntries.length])

  // Filter entries
  useEffect(() => {
    let filtered = entries

    if (levelFilter.length < 4) {
      filtered = filtered.filter((e) => levelFilter.includes(e.level))
    }

    // Build active custom filter matchers
    const activeCustomFilters = customFilters.filter(f => activeFilterIds.has(f.id))

    if (searchTerm || activeCustomFilters.length > 0) {
      filtered = filtered.filter((e) => {
        const haystack = `${e.message} ${e.module} ${e.source}`.toLowerCase()

        // Check plain search term
        if (searchTerm && haystack.includes(searchTerm.toLowerCase())) return true

        // Check each active custom filter (regex or plain)
        for (const cf of activeCustomFilters) {
          try {
            const re = new RegExp(cf.regex, "i")
            if (re.test(e.message) || re.test(e.module) || re.test(e.source)) return true
          } catch {
            if (haystack.includes(cf.regex.toLowerCase())) return true
          }
        }

        return false
      })
    }

    setFilteredEntries(filtered)
    setVisibleCount(100)
  }, [entries, levelFilter, searchTerm, activeFilterIds, customFilters])

  // Parse timestamp format: 20260315T000000.253+0100 -> time in ms from start of day
  const parseTimestamp = (ts: string): number => {
    if (!ts) return 0
    // Extract HHMMSS.mmm from format like 20260315T000334.143+0100
    const timeMatch = ts.match(/T(\d{2})(\d{2})(\d{2})\.(\d{3})/)
    if (timeMatch) {
      const [, h, m, s, ms] = timeMatch
      return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + parseInt(ms)
    }
    return 0
  }

  // Format milliseconds to display string HHMMSS.mmm
  const formatTimeDisplay = (ms: number): string => {
    const hours = Math.floor(ms / 3600000)
    const mins = Math.floor((ms % 3600000) / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    const millis = ms % 1000
    return `${String(hours).padStart(2, '0')}${String(mins).padStart(2, '0')}${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
  }

  // Update slider value visually (no scroll - called during drag)
  const updateSliderValue = (percentage: number) => {
    setSliderValue(percentage)
  }

  // Save filters to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('logAnalyzerFilters', JSON.stringify(customFilters))
    }
  }, [customFilters])

  // Add search to history
  const addToSearchHistory = (term: string) => {
    if (!term.trim()) return
    setSearchHistory(prev => {
      const filtered = prev.filter(t => t !== term)
      return [term, ...filtered].slice(0, 10) // Keep last 10 searches
    })
  }

  // Handle search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    addToSearchHistory(searchTerm)
    setShowSearchHistory(false)
  }

  // Add new filter
  const addFilter = () => {
    if (!newFilterName.trim() || !newFilterRegex.trim()) return
    const newFilter: CustomFilter = {
      id: Date.now().toString(),
      name: newFilterName.trim(),
      regex: newFilterRegex.trim(),
      color: newFilterColor,
      createdAt: new Date().toISOString()
    }
    setCustomFilters(prev => [...prev, newFilter])
    setNewFilterName("")
    setNewFilterRegex("")
    setNewFilterColor("#00F0FF")
  }

  // Delete filter
  const deleteFilter = (id: string) => {
    setCustomFilters(prev => prev.filter(f => f.id !== id))
    setActiveFilterIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // Update filter
  const updateFilter = (updatedFilter: CustomFilter) => {
    setCustomFilters(prev => prev.map(f => f.id === updatedFilter.id ? updatedFilter : f))
    setEditingFilter(null)
  }

  // Toggle a custom filter on/off
  const toggleCustomFilter = (filter: CustomFilter) => {
    setActiveFilterIds(prev => {
      const next = new Set(prev)
      if (next.has(filter.id)) {
        next.delete(filter.id)
      } else {
        next.add(filter.id)
      }
      return next
    })
  }

  // Export filters to JSON
  const exportFilters = () => {
    const data = JSON.stringify(customFilters, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `log-filters-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import filters from JSON
  const importFilters = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const imported: CustomFilter[] = JSON.parse(event.target?.result as string)
        
        // Check for conflicts
        const conflicts: {existing: CustomFilter, incoming: CustomFilter}[] = []
        const newFilters: CustomFilter[] = []

        imported.forEach(incoming => {
          const existing = customFilters.find(f => f.name === incoming.name)
          if (existing) {
            conflicts.push({ existing, incoming })
          } else {
            newFilters.push({ ...incoming, id: Date.now().toString() + Math.random() })
          }
        })

        if (conflicts.length > 0) {
          setImportConflicts(conflicts)
          setCurrentConflictIndex(0)
          setApplyToAll(false)
          setShowImportConflict(true)
          // Add non-conflicting filters immediately
          setCustomFilters(prev => [...prev, ...newFilters])
        } else {
          // No conflicts, add all
          setCustomFilters(prev => [...prev, ...newFilters])
        }
      } catch (err) {
        console.error("Failed to parse filters file:", err)
      }
    }
    reader.readAsText(file)
    e.target.value = '' // Reset input
  }

  // Handle conflict resolution
  const resolveConflict = (overwrite: boolean) => {
    const conflict = importConflicts[currentConflictIndex]
    
    if (overwrite) {
      setCustomFilters(prev => prev.map(f => 
        f.name === conflict.existing.name 
          ? { ...conflict.incoming, id: conflict.existing.id }
          : f
      ))
    }

    if (applyToAll) {
      // Apply same decision to all remaining conflicts
      const remaining = importConflicts.slice(currentConflictIndex + 1)
      if (overwrite) {
        remaining.forEach(c => {
          setCustomFilters(prev => prev.map(f => 
            f.name === c.existing.name 
              ? { ...c.incoming, id: c.existing.id }
              : f
          ))
        })
      }
      setShowImportConflict(false)
      setImportConflicts([])
    } else if (currentConflictIndex < importConflicts.length - 1) {
      setCurrentConflictIndex(prev => prev + 1)
    } else {
      setShowImportConflict(false)
      setImportConflicts([])
    }
  }

  // Jump to a specific line index in the logs (lineId is the entry.id from the log)
  const jumpToLine = (lineId: number) => {
    // Find the index in filtered entries by matching the entry id
    const targetIndex = filteredEntries.findIndex((e) => e.id === lineId)
    
    if (targetIndex === -1) {
      return
    }

    // Load enough entries to reach this index
    if (visibleCount < targetIndex + 50) {
      setVisibleCount(targetIndex + 100)
    }

    // Update slider to reflect position
    const percentage = (targetIndex / (filteredEntries.length - 1)) * 100
    setSliderValue(percentage)

    // Scroll to the entry after a brief delay for rendering
    setTimeout(() => {
      const container = logsContainerRef.current
      if (container) {
        const entryElements = container.querySelectorAll('[data-entry-id]')
        if (entryElements[targetIndex]) {
          entryElements[targetIndex].scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }, 150)
  }

  // Jump to specific position in logs based on slider percentage (only on release)
  const jumpToPosition = (percentage: number) => {
    setSliderValue(percentage)
    
    // Calculate target index based on percentage of filtered entries
    const targetIndex = Math.floor((percentage / 100) * (filteredEntries.length - 1))

    if (targetIndex >= 0 && targetIndex < filteredEntries.length) {
      // Load enough entries to reach this index
      if (visibleCount < targetIndex + 50) {
        setVisibleCount(targetIndex + 100)
      }

      // Scroll to the entry after a brief delay for rendering
      setTimeout(() => {
        const container = logsContainerRef.current
        if (container) {
          const entryElements = container.querySelectorAll('[data-entry-id]')
          if (entryElements[targetIndex]) {
            entryElements[targetIndex].scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
      }, 100)
    }
  }

  const fetchFiles = async () => {
    try {
      const res = await fetch("/api/logs")
      const data = await res.json()
      setFiles(data.files || [])
    } catch (error) {
      console.error("Error fetching files:", error)
    }
  }

  const fetchLogContent = async (filename: string) => {
    setLoading(true)
    setSelectedFile(filename)
    try {
      const res = await fetch(`/api/logs/${encodeURIComponent(filename)}`)
      const data = await res.json()
      setEntries(data.entries || [])
      setStats(data.stats || null)
    } catch (error) {
      console.error("Error fetching log content:", error)
    }
    setLoading(false)
  }

  const toggleLevel = (level: string) => {
    setLevelFilter((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case "ERROR":
        return "text-[#FF2A2A]"
      case "WARNING":
        return "text-[#FFB000]"
      case "INFO":
        return "text-[#00FF66]"
      case "DEBUG":
        return "text-[#52525F]"
      default:
        return "text-[#52525F]"
    }
  }

  const getLevelBadge = (level: string) => {
    switch (level) {
      case "ERROR":
        return "text-[#FF2A2A] bg-[#FF2A2A]/10 border-[#FF2A2A]/20"
      case "WARNING":
        return "text-[#FFB000] bg-[#FFB000]/10 border-[#FFB000]/20"
      case "INFO":
        return "text-[#00FF66] bg-[#00FF66]/10 border-[#00FF66]/20"
      case "DEBUG":
        return "text-[#00F0FF] bg-[#00F0FF]/10 border-[#00F0FF]/20"
      default:
        return "text-[#52525F] bg-[#52525F]/10 border-[#52525F]/20"
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#070709] text-[#E0E0E6] overflow-hidden text-sm font-sans selection:bg-[#00F0FF] selection:text-[#070709]">
      {/* Grid Background */}
      <div 
        className="fixed inset-0 opacity-50 pointer-events-none z-0"
        style={{
          backgroundSize: '40px 40px',
          backgroundImage: 'linear-gradient(to right, #121216 1px, transparent 1px), linear-gradient(to bottom, #121216 1px, transparent 1px)'
        }}
      />

      {/* Corner Markers */}
      <div className="fixed top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-[#52525F] opacity-30 z-50" />
      <div className="fixed top-4 right-4 w-4 h-4 border-t-2 border-r-2 border-[#52525F] opacity-30 z-50" />
      <div className="fixed bottom-4 left-4 w-4 h-4 border-b-2 border-l-2 border-[#52525F] opacity-30 z-50" />
      <div className="fixed bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-[#52525F] opacity-30 z-50" />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#1F1F24] bg-[#121216] px-4 py-2 shrink-0 relative z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="text-[#00F0FF]" fill="none" height="16" viewBox="0 0 48 48" width="16" xmlns="http://www.w3.org/2000/svg">
              <path d="M13.8261 17.4264C16.7203 18.1174 20.2244 18.5217 24 18.5217C27.7756 18.5217 31.2797 18.1174 34.1739 17.4264C36.9144 16.7722 39.9967 15.2331 41.3563 14.1648L24.8486 40.6391C24.4571 41.267 23.5429 41.267 23.1514 40.6391L6.64374 14.1648C8.00331 15.2331 11.0856 16.7722 13.8261 17.4264Z" fill="currentColor"/>
            </svg>
            <h1 className="text-[13px] font-semibold tracking-wider uppercase text-[#E0E0E6]">CYBER MATRIX</h1>
          </div>
          <div className="h-4 w-px bg-[#1F1F24] mx-2" />
          {selectedFile && (
            <span className="text-xs text-[#52525F] font-mono bg-[#1A1A20] px-2 py-0.5 border border-[#1F1F24]">
              /Logs/{selectedFile}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-[#52525F]">
          {stats && (
            <>
              <div className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 bg-[#FF2A2A]" /> {stats.error} Errors
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 bg-[#FFB000]" /> {stats.warning} Warns
              </div>
            </>
          )}
          <button
            onClick={fetchFiles}
            className="text-[#52525F] hover:text-[#00F0FF] transition-colors"
            title="Atualizar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex flex-1 overflow-hidden h-full relative z-10">
        {/* Left Sidebar: File Tree */}
        <aside className={`bg-[#121216] border-r border-[#1F1F24] flex flex-col shrink-0 h-full overflow-y-auto transition-all duration-300 ${sidebarOpen ? 'w-[250px]' : 'w-[50px]'}`}>
          <div className="px-3 py-2 border-b border-[#1F1F24] flex justify-between items-center bg-[#1A1A20] sticky top-0 z-10">
            {sidebarOpen && (
              <span className="text-[11px] font-semibold tracking-widest uppercase text-[#52525F]">Explorer</span>
            )}
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-[#52525F] hover:text-[#00F0FF] ml-auto"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                )}
              </svg>
            </button>
          </div>
          
          <div className="p-2 flex flex-col gap-0.5 text-[13px] font-mono">
            {/* Folder */}
            <div className="group flex items-center gap-2 px-2 py-1 hover:bg-[#1A1A20] cursor-pointer text-[#E0E0E6] font-medium">
              <svg className="w-4 h-4 text-[#52525F] group-hover:text-[#E0E0E6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              {sidebarOpen && <span>/Logs</span>}
            </div>
            
            {/* Files */}
            <div className={`flex flex-col gap-0.5 mt-0.5 ${sidebarOpen ? 'pl-4 border-l border-[#1F1F24] ml-[9px]' : ''}`}>
              {files.length === 0 ? (
                <div className="px-2 py-4 text-center text-[#52525F] text-xs">
                  {sidebarOpen ? 'Nenhum arquivo' : '...'}
                </div>
              ) : (
                files.map((file) => (
                  <button
                    key={file.name}
                    onClick={() => fetchLogContent(file.name)}
                    className={`group flex items-center gap-2 px-2 py-1 cursor-pointer text-left transition-colors ${
                      selectedFile === file.name
                        ? 'bg-[#1A1A20] text-[#00F0FF] border-l-2 border-[#00F0FF] -ml-[1px]'
                        : 'hover:bg-[#1A1A20] text-[#52525F] hover:text-[#E0E0E6]'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {sidebarOpen && (
                      <div className="flex flex-col overflow-hidden">
                        <span className="truncate text-xs">{file.name}</span>
                        <span className="text-[10px] text-[#52525F]">{formatFileSize(file.size)}</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Center: Log Viewer */}
        <section className="flex-1 bg-[#070709] overflow-hidden relative h-full flex flex-col">
          {!selectedFile ? (
            /* Initial State - No file selected */
            <div className="flex-1 flex items-center justify-center">
              <div className="w-[400px] bg-[#121216] border border-[#1F1F24] border-t-2 border-t-[#00F0FF] shadow-[0_0_20px_rgba(0,240,255,0.05)] flex flex-col">
                {/* Modal Header */}
                <div className="px-6 py-5 border-b border-[#1F1F24] flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-[#E0E0E6] text-sm font-semibold tracking-[0.05em] uppercase flex items-center gap-2">
                      <svg className="w-4 h-4 text-[#00F0FF]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4-4 4z"/>
                      </svg>
                      CYBER MATRIX / INIT
                    </h2>
                  </div>
                  <span className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_rgba(0,240,255,0.8)] animate-pulse" />
                </div>
                
                {/* Content */}
                <div className="p-6 flex flex-col gap-6">
                  {/* Visualizer */}
                  <div className="w-full h-32 bg-black border border-[#1F1F24] relative overflow-hidden flex items-center justify-center">
                    <div className="absolute inset-0 opacity-20" style={{backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #00F0FF 2px, #00F0FF 4px)'}} />
                    <div className="text-[#52525F] font-mono text-xs z-10 flex flex-col items-center">
                      <svg className="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                      </svg>
                      <span>NO FILE SELECTED</span>
                    </div>
                  </div>
                  
                  {/* Status */}
                  <div className="bg-black border border-[#1F1F24] p-3 min-h-[60px] flex items-start gap-2">
                    <span className="text-[#00F0FF] font-mono text-xs mt-[2px]">&gt;</span>
                    <div className="flex flex-col font-mono text-xs">
                      <span className="text-[#52525F]">SYSTEM READY.</span>
                      <span className="text-[#52525F] flex items-center">
                        AWAITING FILE SELECTION
                        <span className="inline-block w-2 h-3 bg-[#00F0FF] ml-1 animate-pulse opacity-70" />
                      </span>
                    </div>
                  </div>
                  
                  {/* Action */}
                  <div className="text-center text-[#52525F] text-xs font-mono">
                    SELECT A LOG FILE FROM THE EXPLORER
                  </div>
                </div>
                
                {/* Progress Bar */}
                <div className="h-[2px] w-full bg-[#1F1F24] overflow-hidden relative">
                  <div className="absolute top-0 left-0 h-full w-1/3 bg-[#00F0FF] animate-[scan_2s_linear_infinite] opacity-50" />
                </div>
              </div>
            </div>
          ) : (
            /* Log Viewer */
            <>
              {/* Filter Bar */}
              <div className="px-4 py-2 border-b border-[#1F1F24] bg-[#121216] flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[#00F0FF] font-mono text-xs">[CONSOLE]</span>
                  
                  {/* Search with History */}
                  <div className="relative flex-1 max-w-md">
                    <form onSubmit={handleSearchSubmit}>
                      <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#52525F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Regex filter..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onFocus={() => setShowSearchHistory(true)}
                        onBlur={() => setTimeout(() => setShowSearchHistory(false), 200)}
                        className="w-full bg-[#070709] border border-[#1F1F24] text-[#E0E0E6] pl-8 pr-3 py-1 text-xs font-mono focus:outline-none focus:border-[#00F0FF] transition-colors placeholder:text-[#52525F]"
                      />
                    </form>
                    
                    {/* Search History Dropdown */}
                    {showSearchHistory && searchHistory.length > 0 && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-[#121216] border border-[#1F1F24] z-50 max-h-48 overflow-y-auto">
                        <div className="px-2 py-1 text-[8px] font-mono text-[#52525F] uppercase border-b border-[#1F1F24]">Search History</div>
                        {searchHistory.map((term, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setSearchTerm(term)
                              setShowSearchHistory(false)
                            }}
                            className="w-full px-2 py-1.5 text-left text-xs font-mono text-[#E0E0E6] hover:bg-[#1A1A20] flex items-center gap-2"
                          >
                            <svg className="w-3 h-3 text-[#52525F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="truncate">{term}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Filter Button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowFilterMenu(!showFilterMenu)}
                      className={`px-2 py-1 text-[10px] font-mono border transition-all flex items-center gap-1 ${
                        showFilterMenu 
                          ? 'bg-[#00F0FF]/10 border-[#00F0FF] text-[#00F0FF]' 
                          : 'bg-transparent border-[#1F1F24] text-[#52525F] hover:border-[#00F0FF] hover:text-[#00F0FF]'
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                      FILTERS
                      {activeFilterIds.size > 0 && (
                        <span className="bg-[#00F0FF] text-black px-1 text-[8px] font-bold">{activeFilterIds.size}</span>
                      )}
                      {customFilters.length > 0 && activeFilterIds.size === 0 && (
                        <span className="bg-[#52525F]/30 text-[#52525F] px-1 text-[8px] font-bold">{customFilters.length}</span>
                      )}
                    </button>

                    {/* Filter Menu */}
                    {showFilterMenu && (
                      <div className="absolute top-full right-0 mt-1 w-72 bg-[#121216] border border-[#1F1F24] z-50">
                        {/* Header */}
                        <div className="px-3 py-2 border-b border-[#1F1F24] flex justify-between items-center">
                          <span className="text-[9px] font-mono text-[#52525F] uppercase tracking-widest">Custom Filters</span>
                          <button
                            onClick={() => setShowFilterEditor(true)}
                            className="text-[#52525F] hover:text-[#00F0FF] transition-colors"
                            title="Editar filtros"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        </div>

                        {/* Filter List */}
                        <div className="max-h-48 overflow-y-auto">
                          {customFilters.length === 0 ? (
                            <div className="px-3 py-4 text-center text-[9px] font-mono text-[#52525F]">
                              Nenhum filtro personalizado
                            </div>
                          ) : (
                            customFilters.map((filter) => {
                              const isActive = activeFilterIds.has(filter.id)
                              return (
                                <button
                                  key={filter.id}
                                  onClick={() => toggleCustomFilter(filter)}
                                  className={`w-full px-3 py-2 text-left flex items-center gap-2 border-b border-[#1F1F24]/50 transition-colors ${
                                    isActive
                                      ? "bg-[#1A1A20]"
                                      : "hover:bg-[#1A1A20]/50"
                                  }`}
                                >
                                  {/* Active indicator dot */}
                                  <div
                                    className={`w-2 h-2 flex-shrink-0 transition-all ${isActive ? "shadow-[0_0_6px_currentColor]" : "opacity-40"}`}
                                    style={{ backgroundColor: filter.color }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className={`text-[10px] font-mono truncate ${isActive ? "text-[#E0E0E6]" : "text-[#52525F]"}`}>
                                      {filter.name}
                                    </div>
                                    <div className="text-[8px] font-mono text-[#52525F] truncate">{filter.regex}</div>
                                  </div>
                                  {/* Active badge */}
                                  {isActive && (
                                    <span
                                      className="px-1 py-0.5 text-[7px] font-mono font-bold flex-shrink-0"
                                      style={{ backgroundColor: `${filter.color}22`, color: filter.color }}
                                    >
                                      ON
                                    </span>
                                  )}
                                </button>
                              )
                            })
                          )}
                        </div>

                        {/* Add New Filter */}
                        <div className="p-3 border-t border-[#1F1F24]">
                          <div className="flex flex-col gap-2">
                            <input
                              type="text"
                              placeholder="Nome do filtro..."
                              value={newFilterName}
                              onChange={(e) => setNewFilterName(e.target.value)}
                              className="w-full bg-[#070709] border border-[#1F1F24] text-[#E0E0E6] px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-[#00F0FF] placeholder:text-[#52525F]"
                            />
                            <input
                              type="text"
                              placeholder="Regex pattern..."
                              value={newFilterRegex}
                              onChange={(e) => setNewFilterRegex(e.target.value)}
                              className="w-full bg-[#070709] border border-[#1F1F24] text-[#E0E0E6] px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-[#00F0FF] placeholder:text-[#52525F]"
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={newFilterColor}
                                onChange={(e) => setNewFilterColor(e.target.value)}
                                className="w-6 h-6 bg-transparent border border-[#1F1F24] cursor-pointer"
                              />
                              <span className="text-[8px] font-mono text-[#52525F]">Cor</span>
                            </div>
                          </div>
                        </div>

                        {/* Footer Buttons */}
                        <div className="p-2 border-t border-[#1F1F24] flex gap-1">
                          <button
                            onClick={addFilter}
                            className="flex-1 px-2 py-1.5 text-[9px] font-mono bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] hover:bg-[#00F0FF]/20 transition-colors"
                          >
                            + Add Filter
                          </button>
                          <label className="flex-1 px-2 py-1.5 text-[9px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:text-[#00F0FF] hover:border-[#00F0FF]/30 transition-colors text-center cursor-pointer">
                            Import
                            <input
                              type="file"
                              accept=".json"
                              onChange={importFilters}
                              className="hidden"
                            />
                          </label>
                          <button
                            onClick={exportFilters}
                            disabled={customFilters.length === 0}
                            className="flex-1 px-2 py-1.5 text-[9px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:text-[#00F0FF] hover:border-[#00F0FF]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Export
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-1">
                  {["INFO", "DEBUG", "WARNING", "ERROR"].map((level) => (
                    <button
                      key={level}
                      onClick={() => toggleLevel(level)}
                      className={`px-2 py-0.5 text-[10px] font-mono border transition-all ${
                        levelFilter.includes(level)
                          ? getLevelBadge(level)
                          : "text-[#52525F] border-[#1F1F24] bg-transparent opacity-50"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats Bar */}
              {stats && (
                <div className="px-4 py-2 border-b border-[#1F1F24] bg-[#0d0d11] flex items-center gap-6 font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-[#52525F]">TOTAL:</span>
                    <span className="text-[#E0E0E6]">{stats.total.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#52525F]">INFO:</span>
                    <span className="text-[#00FF66]">{stats.info.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#52525F]">DEBUG:</span>
                    <span className="text-[#52525F]">{stats.debug.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#52525F]">WARN:</span>
                    <span className="text-[#FFB000]">{stats.warning.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#52525F]">ERROR:</span>
                    <span className="text-[#FF2A2A]">{stats.error.toLocaleString()}</span>
                  </div>
                  <div className="ml-auto text-[#52525F]">
                    Showing {Math.min(visibleCount, filteredEntries.length)} of {filteredEntries.length}
                  </div>
                </div>
              )}

              {/* Log Lines */}
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-6 h-6 text-[#00F0FF] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="text-[#52525F] font-mono text-xs">LOADING...</span>
                  </div>
                </div>
                    ) : (
                      <div ref={logsContainerRef} className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed select-text cursor-text">
                      {filteredEntries.slice(0, visibleCount).map((entry, idx) => (
                        <div
                          key={entry.id}
                          data-entry-id={idx}
                          className={`flex hover:bg-[#1A1A20] border-b border-transparent hover:border-[#1F1F24] transition-colors group px-2 ${
                        entry.level === "ERROR" ? "bg-[#FF2A2A]/5" : 
                        entry.level === "WARNING" ? "bg-[#FFB000]/5" : ""
                      }`}
                    >
                      <div className={`w-12 shrink-0 text-right pr-3 select-none flex items-center justify-end ${
                        entry.level === "ERROR" ? "text-[#FF2A2A]" : "text-[#52525F]"
                      }`}>
                        {entry.id}
                      </div>
                      <div className="w-14 shrink-0 flex items-center">
                        <span className={`px-1 py-0.5 border text-[10px] ${getLevelBadge(entry.level)} ${
                          entry.level === "ERROR" ? "animate-pulse" : ""
                        }`}>
                          {entry.level}
                        </span>
                      </div>
                      <div className="w-44 shrink-0 text-[#52525F] whitespace-nowrap">{entry.timestamp}</div>
                      <div className={`flex-1 break-all ${entry.level === "ERROR" ? "text-[#FF2A2A]" : "text-[#E0E0E6]"}`}>
                        {entry.message}
                      </div>
                    </div>
                  ))}

                  {visibleCount >= filteredEntries.length && filteredEntries.length > 0 && (
                    <div className="p-4 text-center border-t border-[#1F1F24]">
                      <p className="text-[#00F0FF] font-mono text-xs tracking-widest">
                        [ END OF FILE ]
                      </p>
                    </div>
                  )}

                  {/* Auto-load trigger */}
                  <div ref={loadMoreRef} className="h-1" />
                </div>
              )}
            </>
          )}
        </section>

        {/* Quick Stats Toggle Tab (always visible when file is selected) */}
        {selectedFile && stats && !statsOpen && (
          <button
            onClick={() => setStatsOpen(true)}
            className="w-8 bg-[#121216] border-l border-[#1F1F24] flex flex-col items-center justify-start pt-4 shrink-0 hover:bg-[#1A1A20] transition-colors group"
            title="Abrir Quick Stats"
          >
            <svg className="w-3.5 h-3.5 text-[#52525F] group-hover:text-[#00F0FF] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-[#52525F] font-mono text-[8px] tracking-widest mt-2 [writing-mode:vertical-rl] group-hover:text-[#00F0FF] transition-colors">STATS</span>
          </button>
        )}

        {/* Right Sidebar: Quick Stats */}
        {selectedFile && stats && statsOpen && (
          <aside className="w-[280px] bg-[#121216] border-l border-[#1F1F24] flex flex-col shrink-0 overflow-y-auto">

            {/* Header */}
            <div className="px-4 py-3 border-b border-[#1F1F24] flex justify-between items-center sticky top-0 bg-[#121216] z-10">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#E0E0E6] font-mono">QUICK_STATS</span>
              <button
                onClick={() => setStatsOpen(false)}
                className="text-[#52525F] hover:text-[#00F0FF] transition-colors"
                title="Fechar Quick Stats"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Health Distribution (Donut) */}
            <div className="p-4 border-b border-[#1F1F24]">
              <div className="text-[9px] font-mono text-[#52525F] mb-3 uppercase tracking-widest">System_Health_Distribution</div>
              <div className="relative flex justify-center items-center py-3">
                <svg className="w-32 h-32 -rotate-90">
                  <circle cx="64" cy="64" r="54" fill="transparent" stroke="#1F1F24" strokeWidth="8" />
                  <circle cx="64" cy="64" r="54" fill="transparent" stroke="#00FF66" strokeWidth="12"
                    strokeDasharray={`${(stats.info / stats.total) * 339} 339`}
                    strokeDashoffset="0" />
                  <circle cx="64" cy="64" r="54" fill="transparent" stroke="#FFB000" strokeWidth="12"
                    strokeDasharray={`${(stats.warning / stats.total) * 339} 339`}
                    strokeDashoffset={`${-((stats.info / stats.total) * 339)}`} />
                  <circle cx="64" cy="64" r="54" fill="transparent" stroke="#FF2A2A" strokeWidth="12"
                    strokeDasharray={`${(stats.error / stats.total) * 339} 339`}
                    strokeDashoffset={`${-(((stats.info + stats.warning) / stats.total) * 339)}`} />
                </svg>
                <div className="absolute inset-0 flex flex-col justify-center items-center">
                  <span className="font-mono text-lg font-bold text-[#E0E0E6]">
                    {stats.total > 0 ? ((1 - stats.error / stats.total) * 100).toFixed(1) : 0}%
                  </span>
                  <span className="font-mono text-[8px] text-[#00FF66]">STABLE</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="flex flex-col">
                  <span className="text-[8px] font-mono text-[#52525F]">INFO</span>
                  <span className="text-[11px] font-mono text-[#00FF66]">{stats.info >= 1000 ? `${(stats.info/1000).toFixed(1)}K` : stats.info}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] font-mono text-[#52525F]">WARN</span>
                  <span className="text-[11px] font-mono text-[#FFB000]">{stats.warning}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] font-mono text-[#52525F]">ERROR</span>
                  <span className="text-[11px] font-mono text-[#FF2A2A]">{stats.error}</span>
                </div>
              </div>
            </div>

            {/* Time Selector Navigation */}
            <div className="p-4 border-b border-[#1F1F24]">
              <div className="flex justify-between items-center mb-3">
                <div className="text-[9px] font-mono text-[#52525F] uppercase tracking-widest">Time_Navigator</div>
                <span className="text-[8px] font-mono text-[#00F0FF]">SEEK</span>
              </div>

              {stats.firstTs && stats.lastTs && filteredEntries.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {/* Current position display */}
                  <div className="bg-[#1A1A20] border border-[#00F0FF]/30 p-3">
                    <div className="text-[9px] font-mono text-[#52525F] mb-1">CURRENT_POSITION</div>
                    <div className="text-[14px] font-mono text-[#00F0FF] font-bold tracking-wider">
                      {(() => {
                        const idx = Math.floor((sliderValue / 100) * (filteredEntries.length - 1))
                        const entry = filteredEntries[idx]
                        if (entry?.timestamp) {
                          // Extract time part: 20260315T000334.143 -> 000334.143
                          const match = entry.timestamp.match(/T(\d{6}\.\d{3})/)
                          return match ? match[1] : entry.timestamp
                        }
                        return "-------.---"
                      })()}
                    </div>
                    <div className="text-[9px] font-mono text-[#52525F] mt-1">
                      Linha {Math.floor((sliderValue / 100) * (filteredEntries.length - 1)) + 1} / {filteredEntries.length}
                    </div>
                  </div>

                  {/* Time range display */}
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex-1">
                      <div className="text-[8px] font-mono text-[#52525F]">START</div>
                      <div className="text-[10px] font-mono text-[#00FF66]">
                        {(() => {
                          const match = stats.firstTs.match(/T(\d{6}\.\d{3})/)
                          return match ? match[1] : stats.firstTs
                        })()}
                      </div>
                    </div>
                    <div className="w-px h-6 bg-[#1F1F24]"></div>
                    <div className="flex-1 text-right">
                      <div className="text-[8px] font-mono text-[#52525F]">END</div>
                      <div className="text-[10px] font-mono text-[#FF2A2A]">
                        {(() => {
                          const match = stats.lastTs.match(/T(\d{6}\.\d{3})/)
                          return match ? match[1] : stats.lastTs
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Single timeline slider */}
                  <div className="mt-1">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={sliderValue}
                      className="w-full h-2 bg-[#1F1F24] accent-[#00F0FF] cursor-pointer appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#00F0FF] [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(0,240,255,0.6)] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing"
                      onChange={(e) => updateSliderValue(parseFloat(e.target.value))}
                      onMouseUp={(e) => jumpToPosition(parseFloat((e.target as HTMLInputElement).value))}
                      onTouchEnd={(e) => jumpToPosition(parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[8px] font-mono text-[#52525F]">0%</span>
                      <span className="text-[9px] font-mono text-[#00F0FF] font-bold">{sliderValue.toFixed(1)}%</span>
                      <span className="text-[8px] font-mono text-[#52525F]">100%</span>
                    </div>
                  </div>

                  {/* Quick jump buttons */}
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => jumpToPosition(0)}
                      className="flex-1 px-2 py-1 text-[8px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:border-[#00F0FF] hover:text-[#00F0FF] transition-colors"
                    >
                      START
                    </button>
                    <button
                      onClick={() => jumpToPosition(25)}
                      className="flex-1 px-2 py-1 text-[8px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:border-[#00F0FF] hover:text-[#00F0FF] transition-colors"
                    >
                      25%
                    </button>
                    <button
                      onClick={() => jumpToPosition(50)}
                      className="flex-1 px-2 py-1 text-[8px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:border-[#00F0FF] hover:text-[#00F0FF] transition-colors"
                    >
                      50%
                    </button>
                    <button
                      onClick={() => jumpToPosition(75)}
                      className="flex-1 px-2 py-1 text-[8px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:border-[#00F0FF] hover:text-[#00F0FF] transition-colors"
                    >
                      75%
                    </button>
                    <button
                      onClick={() => jumpToPosition(100)}
                      className="flex-1 px-2 py-1 text-[8px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:border-[#00F0FF] hover:text-[#00F0FF] transition-colors"
                    >
                      END
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[9px] font-mono text-[#52525F] text-center py-4">
                  Selecione um arquivo de log
                </div>
              )}
            </div>

            {/* Critical Anomalies */}
            {stats.anomalies.length > 0 && (
              <div className="p-4">
                <div className="text-[9px] font-mono text-[#52525F] mb-3 uppercase tracking-widest">Critical_Anomalies</div>
                <div className="flex flex-col gap-2">
                  {stats.anomalies.map((a, i) => (
                    <button
                      key={a.id}
                      onClick={() => jumpToLine(a.index)}
                      className={`bg-[#1A1A20] p-2.5 border border-[#1F1F24] hover:border-[#FF2A2A] hover:bg-[#1F1F24] transition-colors group text-left cursor-pointer ${i >= 2 ? 'opacity-50 hover:opacity-100' : ''}`}
                      title={`Ir para linha ${a.index}`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[9px] font-mono text-[#FF2A2A] font-bold">#{a.id}</span>
                        <span className="bg-[#FF2A2A]/10 text-[#FF2A2A] px-1 py-0.5 text-[8px] font-mono font-bold">
                          {i === 0 ? "NEW" : i === 1 ? "01" : "OK"}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-[#E0E0E6] leading-tight break-all">{a.message.slice(0, 60)}{a.message.length > 60 ? "..." : ""}</p>
                      <div className="mt-1.5 flex justify-between items-center">
                        <span className="text-[8px] font-mono text-[#52525F] truncate max-w-[160px]">{a.module || a.timestamp.slice(11, 19)}</span>
                        {i >= 2 && <span className="text-[8px] font-mono text-[#52525F]">RESOLVED</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="p-3 mt-auto border-t border-[#1F1F24] flex justify-between items-center bg-[#0d0d11] sticky bottom-0">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#00FF66] rounded-full animate-pulse" />
                <span className="text-[9px] font-mono text-[#00FF66] uppercase">Node_Secure</span>
              </div>
              <span className="text-[9px] font-mono text-[#52525F] uppercase">ID: ZX-00-88</span>
            </div>
          </aside>
        )}
      </main>

      {/* Footer */}
      <footer className="h-7 bg-[#121216] border-t border-[#1F1F24] flex items-center px-4 shrink-0 font-mono text-[10px] justify-between relative z-10">
        <div className="flex items-center gap-3 text-[#52525F]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="opacity-50">Press &apos;/&apos; to focus Regex Filter Console...</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-1.5 py-0.5 border border-[#1F1F24] text-[#52525F] bg-[#070709]">.*</div>
          <div className="px-1.5 py-0.5 border border-[#1F1F24] text-[#52525F] bg-[#070709]">Aa</div>
        </div>
      </footer>

      {/* Filter Editor Modal */}
      {showFilterEditor && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowFilterEditor(false)}>
          <div className="bg-[#121216] border border-[#1F1F24] w-[500px] max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#1F1F24] flex justify-between items-center">
              <span className="text-[11px] font-mono text-[#E0E0E6] uppercase tracking-widest">Filter Editor</span>
              <button
                onClick={() => setShowFilterEditor(false)}
                className="text-[#52525F] hover:text-[#FF2A2A] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Filter List */}
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {customFilters.length === 0 ? (
                <div className="text-center py-8 text-[#52525F] font-mono text-xs">
                  Nenhum filtro para editar
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {customFilters.map((filter) => (
                    <div key={filter.id} className="bg-[#1A1A20] border border-[#1F1F24] p-3">
                      {editingFilter?.id === filter.id ? (
                        // Edit Mode
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            value={editingFilter.name}
                            onChange={(e) => setEditingFilter({...editingFilter, name: e.target.value})}
                            className="w-full bg-[#070709] border border-[#1F1F24] text-[#E0E0E6] px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-[#00F0FF]"
                          />
                          <input
                            type="text"
                            value={editingFilter.regex}
                            onChange={(e) => setEditingFilter({...editingFilter, regex: e.target.value})}
                            className="w-full bg-[#070709] border border-[#1F1F24] text-[#E0E0E6] px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-[#00F0FF]"
                          />
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={editingFilter.color}
                              onChange={(e) => setEditingFilter({...editingFilter, color: e.target.value})}
                              className="w-6 h-6 bg-transparent border border-[#1F1F24] cursor-pointer"
                            />
                            <button
                              onClick={() => updateFilter(editingFilter)}
                              className="px-2 py-1 text-[9px] font-mono bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] hover:bg-[#00F0FF]/20"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setEditingFilter(null)}
                              className="px-2 py-1 text-[9px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:text-[#E0E0E6]"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        // View Mode
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3" style={{ backgroundColor: filter.color }} />
                            <div>
                              <div className="text-[10px] font-mono text-[#E0E0E6]">{filter.name}</div>
                              <div className="text-[8px] font-mono text-[#52525F]">{filter.regex}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditingFilter(filter)}
                              className="p-1 text-[#52525F] hover:text-[#00F0FF] transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => deleteFilter(filter.id)}
                              className="p-1 text-[#52525F] hover:text-[#FF2A2A] transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import Conflict Modal */}
      {showImportConflict && importConflicts.length > 0 && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-[#121216] border border-[#1F1F24] w-[600px] max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#1F1F24] flex justify-between items-center">
              <span className="text-[11px] font-mono text-[#FFB000] uppercase tracking-widest flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Conflito de Importação ({currentConflictIndex + 1}/{importConflicts.length})
              </span>
              <button
                onClick={() => { setShowImportConflict(false); setImportConflicts([]) }}
                className="text-[#52525F] hover:text-[#FF2A2A] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Conflict Content */}
            <div className="p-4">
              <div className="text-[10px] font-mono text-[#E0E0E6] mb-4">
                O filtro <span className="text-[#00F0FF]">&quot;{importConflicts[currentConflictIndex].existing.name}&quot;</span> já existe. Deseja sobrescrever?
              </div>

              {/* Compare View */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Current */}
                <div className="bg-[#1A1A20] border border-[#1F1F24] p-3">
                  <div className="text-[9px] font-mono text-[#52525F] uppercase mb-2">Filtro Atual</div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3" style={{ backgroundColor: importConflicts[currentConflictIndex].existing.color }} />
                    <span className="text-[10px] font-mono text-[#E0E0E6]">{importConflicts[currentConflictIndex].existing.name}</span>
                  </div>
                  <div className="text-[9px] font-mono text-[#52525F] bg-[#070709] p-2 border border-[#1F1F24]">
                    {importConflicts[currentConflictIndex].existing.regex}
                  </div>
                </div>

                {/* Incoming */}
                <div className="bg-[#1A1A20] border border-[#00F0FF]/30 p-3">
                  <div className="text-[9px] font-mono text-[#00F0FF] uppercase mb-2">Filtro Novo</div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3" style={{ backgroundColor: importConflicts[currentConflictIndex].incoming.color }} />
                    <span className="text-[10px] font-mono text-[#E0E0E6]">{importConflicts[currentConflictIndex].incoming.name}</span>
                  </div>
                  <div className="text-[9px] font-mono text-[#52525F] bg-[#070709] p-2 border border-[#1F1F24]">
                    {importConflicts[currentConflictIndex].incoming.regex}
                  </div>
                </div>
              </div>

              {/* Diff Highlight */}
              {importConflicts[currentConflictIndex].existing.regex !== importConflicts[currentConflictIndex].incoming.regex && (
                <div className="bg-[#FFB000]/10 border border-[#FFB000]/30 p-2 mb-4">
                  <div className="text-[8px] font-mono text-[#FFB000] uppercase mb-1">Diferença</div>
                  <div className="text-[9px] font-mono text-[#E0E0E6]">
                    <span className="text-[#FF2A2A] line-through">{importConflicts[currentConflictIndex].existing.regex}</span>
                    <span className="mx-2">→</span>
                    <span className="text-[#00FF66]">{importConflicts[currentConflictIndex].incoming.regex}</span>
                  </div>
                </div>
              )}

              {/* Apply to All Checkbox */}
              {importConflicts.length > 1 && (
                <label className="flex items-center gap-2 mb-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToAll}
                    onChange={(e) => setApplyToAll(e.target.checked)}
                    className="w-3 h-3 accent-[#00F0FF]"
                  />
                  <span className="text-[9px] font-mono text-[#52525F]">
                    Aplicar mesma ação para todos os {importConflicts.length - currentConflictIndex} conflitos restantes
                  </span>
                </label>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => resolveConflict(true)}
                  className="flex-1 px-3 py-2 text-[10px] font-mono bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] hover:bg-[#00F0FF]/20 transition-colors"
                >
                  Sobrescrever
                </button>
                <button
                  onClick={() => resolveConflict(false)}
                  className="flex-1 px-3 py-2 text-[10px] font-mono bg-[#1A1A20] border border-[#1F1F24] text-[#52525F] hover:text-[#E0E0E6] transition-colors"
                >
                  Manter Atual
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        
        /* Custom Scrollbar */
        ::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #52525F;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #E0E0E6;
        }
      `}</style>
    </div>
  )
}
