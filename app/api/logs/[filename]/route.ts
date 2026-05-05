import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params
    const logsDir = path.join(process.cwd(), "Logs")
    const filePath = path.join(logsDir, filename)

    if (!filePath.startsWith(logsDir)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n").filter((line) => line.trim())

    const entries = lines.map((line, index) => {
      const parts = line.split("\t")
      if (parts.length >= 7) {
        return {
          id: index + 1,
          level: parts[0]?.trim() || "UNKNOWN",
          timestamp: parts[1]?.trim() || "",
          thread: parts[2]?.trim() || "",
          module: parts[3]?.trim() || "",
          code: parts[4]?.trim() || "",
          source: parts[5]?.trim() || "",
          message: parts.slice(6).join("\t").trim() || "",
          raw: line,
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
        message: line,
        raw: line,
      }
    })

    const total = entries.length
    const infoCount = entries.filter((e) => e.level === "INFO").length
    const debugCount = entries.filter((e) => e.level === "DEBUG").length
    const warningCount = entries.filter((e) => e.level === "WARNING").length
    const errorCount = entries.filter((e) => e.level === "ERROR").length

    // Build timeline: split entries into 12 time buckets
    const bucketCount = 12
    const bucketSize = Math.max(1, Math.ceil(total / bucketCount))
    const timeline: number[] = Array.from({ length: bucketCount }, (_, i) => {
      const slice = entries.slice(i * bucketSize, (i + 1) * bucketSize)
      return slice.length
    })
    const timelineMax = Math.max(...timeline, 1)

    // Top modules by error/warning count
    const moduleMap: Record<string, { errors: number; warnings: number; total: number }> = {}
    for (const e of entries) {
      if (!e.module) continue
      if (!moduleMap[e.module]) moduleMap[e.module] = { errors: 0, warnings: 0, total: 0 }
      moduleMap[e.module].total++
      if (e.level === "ERROR") moduleMap[e.module].errors++
      if (e.level === "WARNING") moduleMap[e.module].warnings++
    }
    const topModules = Object.entries(moduleMap)
      .sort((a, b) => b[1].errors - a[1].errors || b[1].warnings - a[1].warnings)
      .slice(0, 5)
      .map(([name, v]) => ({ name, ...v }))

    // Critical anomalies: last N error entries
    const errorEntries = entries.filter((e) => e.level === "ERROR").slice(-5).reverse()
    const anomalies = errorEntries.map((e) => ({
      id: `ANOMALY_${e.id}`,
      message: e.message.slice(0, 80),
      module: e.module,
      timestamp: e.timestamp,
      index: e.id, // Use the actual entry ID (line number)
    }))

    // Execution time estimation from timestamps
    let avgExecMs = 0
    let maxExecMs = 0
    let minExecMs = 9999
    const execTimes: number[] = []
    for (let i = 1; i < Math.min(entries.length, 200); i++) {
      const prev = entries[i - 1].timestamp
      const curr = entries[i].timestamp
      if (prev && curr) {
        const a = new Date(prev).getTime()
        const b = new Date(curr).getTime()
        if (!isNaN(a) && !isNaN(b) && b >= a) {
          const diff = b - a
          if (diff < 60000) execTimes.push(diff)
        }
      }
    }
    if (execTimes.length > 0) {
      avgExecMs = Math.round(execTimes.reduce((a, b) => a + b, 0) / execTimes.length)
      maxExecMs = Math.max(...execTimes)
      minExecMs = Math.min(...execTimes)
    }

    // First and last timestamps
    const firstTs = entries.find((e) => e.timestamp)?.timestamp || ""
    const lastTs = [...entries].reverse().find((e) => e.timestamp)?.timestamp || ""

    const stats = {
      total,
      info: infoCount,
      debug: debugCount,
      warning: warningCount,
      error: errorCount,
      timeline,
      timelineMax,
      topModules,
      anomalies,
      execTime: { avg: avgExecMs, max: maxExecMs, min: minExecMs },
      firstTs,
      lastTs,
    }

    return NextResponse.json({ entries, stats })
  } catch (error) {
    console.error("Error reading log file:", error)
    return NextResponse.json({ error: "Failed to read log file" }, { status: 500 })
  }
}
