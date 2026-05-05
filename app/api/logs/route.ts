import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export async function GET() {
  try {
    const logsDir = path.join(process.cwd(), "Logs")

    // Check if Logs directory exists
    if (!fs.existsSync(logsDir)) {
      // Create the directory if it doesn't exist
      fs.mkdirSync(logsDir, { recursive: true })
      return NextResponse.json({ files: [] })
    }

    // Read all .log files from the Logs directory
    const files = fs.readdirSync(logsDir).filter((file) => file.endsWith(".log"))

    // Get file stats for each file
    const filesWithStats = files.map((file) => {
      const filePath = path.join(logsDir, file)
      const stats = fs.statSync(filePath)
      return {
        name: file,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      }
    })

    // Sort by modified date (most recent first)
    filesWithStats.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())

    return NextResponse.json({ files: filesWithStats })
  } catch (error) {
    console.error("Error reading logs directory:", error)
    return NextResponse.json({ error: "Failed to read logs directory" }, { status: 500 })
  }
}
