"use client"

import { useCallback, useState } from "react"

import { analyzeEntries } from "@/lib/logs/analyzer"
import { parseLogText } from "@/lib/logs/parser"
import { LogEntry, LogStats } from "@/lib/logs/types"

export interface ExplorerFileNode {
  kind: "file"
  id: string
  name: string
  path: string
  fileId: string
}

export interface ExplorerDirectoryNode {
  kind: "directory"
  id: string
  name: string
  path: string
  children: ExplorerTreeNode[]
}

export type ExplorerTreeNode = ExplorerFileNode | ExplorerDirectoryNode

export interface SelectedLogFile {
  id: string
  name: string
  relativePath: string
  size: number
  modified: string
  lastModified: number
  file: File
}

function getRelativePath(file: File): string {
  return file.webkitRelativePath || file.name
}

function getFolderLabel(files: File[]): string {
  const relativePath = files[0]?.webkitRelativePath

  if (!relativePath) {
    return "Arquivos locais"
  }

  return relativePath.split("/")[0] || "Arquivos locais"
}

function normalizeFiles(files: File[]): SelectedLogFile[] {
  return files
    .filter((file) => file.name.toLowerCase().endsWith(".log"))
    .sort((left, right) => right.lastModified - left.lastModified)
    .map((file) => ({
      id: `${getRelativePath(file)}-${file.lastModified}-${file.size}`,
      name: file.name,
      relativePath: getRelativePath(file),
      size: file.size,
      modified: new Date(file.lastModified).toISOString(),
      lastModified: file.lastModified,
      file,
    }))
}

function sortTreeNodes(nodes: ExplorerTreeNode[]): ExplorerTreeNode[] {
  return [...nodes]
    .map((node) => {
      if (node.kind === "directory") {
        return {
          ...node,
          children: sortTreeNodes(node.children),
        }
      }

      return node
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    })
}

function buildFileTree(files: SelectedLogFile[]): ExplorerTreeNode[] {
  const roots: ExplorerTreeNode[] = []

  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean)

    if (parts.length === 0) {
      continue
    }

    let currentNodes = roots
    let currentPath = ""

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isFile = index === parts.length - 1

      if (isFile) {
        currentNodes.push({
          kind: "file",
          id: `${currentPath}:${file.id}`,
          name: part,
          path: currentPath,
          fileId: file.id,
        })
        continue
      }

      let nextDirectory = currentNodes.find(
        (node): node is ExplorerDirectoryNode => node.kind === "directory" && node.path === currentPath,
      )

      if (!nextDirectory) {
        nextDirectory = {
          kind: "directory",
          id: currentPath,
          name: part,
          path: currentPath,
          children: [],
        }
        currentNodes.push(nextDirectory)
      }

      currentNodes = nextDirectory.children
    }
  }

  return sortTreeNodes(roots)
}

export function useLogFiles() {
  const [files, setFiles] = useState<SelectedLogFile[]>([])
  const [fileTree, setFileTree] = useState<ExplorerTreeNode[]>([])
  const [folderLabel, setFolderLabel] = useState("Nenhuma pasta selecionada")
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null

  const loadSelectedFile = useCallback(async (file: SelectedLogFile) => {
    setLoading(true)
    setSelectedFileId(file.id)
    setError(null)

    try {
      const text = await file.file.text()
      const parsedEntries = parseLogText(text)
      setEntries(parsedEntries)
      setStats(analyzeEntries(parsedEntries))
    } catch {
      setEntries([])
      setStats(null)
      setError(`Não foi possível ler o arquivo ${file.name}.`)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadFiles = useCallback(
    async (inputFiles: File[]) => {
      const normalized = normalizeFiles(inputFiles)
      setFiles(normalized)
      setFileTree(buildFileTree(normalized))
      setFolderLabel(inputFiles.length > 0 ? getFolderLabel(inputFiles) : "Nenhuma pasta selecionada")

      if (normalized.length === 0) {
        setSelectedFileId(null)
        setEntries([])
        setStats(null)
        setError("Nenhum arquivo .log foi encontrado na pasta selecionada.")
        return
      }

      setError(null)

      await loadSelectedFile(normalized[0])
    },
    [loadSelectedFile],
  )

  const selectFile = useCallback(
    async (fileId: string) => {
      const file = files.find((item) => item.id === fileId)

      if (!file) {
        return
      }

      await loadSelectedFile(file)
    },
    [files, loadSelectedFile],
  )

  return {
    files,
    fileTree,
    folderLabel,
    selectedFile,
    entries,
    stats,
    loading,
    error,
    loadFiles,
    selectFile,
  }
}
