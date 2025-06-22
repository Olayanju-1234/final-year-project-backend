import { createWriteStream, existsSync, mkdirSync } from "fs"
import { join } from "path"

class Logger {
  private logStream: NodeJS.WritableStream | null = null

  constructor() {
    this.initializeLogStream()
  }

  private initializeLogStream(): void {
    const logsDir = join(process.cwd(), "logs")

    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true })
    }

    const logFile = join(logsDir, `app-${new Date().toISOString().split("T")[0]}.log`)
    this.logStream = createWriteStream(logFile, { flags: "a" })
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString()
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : ""
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}\n`
  }

  private log(level: string, message: string, meta?: any): void {
    const formattedMessage = this.formatMessage(level, message, meta)

    // Console output with colors
    const colors = {
      info: "\x1b[36m", // Cyan
      warn: "\x1b[33m", // Yellow
      error: "\x1b[31m", // Red
      debug: "\x1b[35m", // Magenta
      reset: "\x1b[0m", // Reset
    }

    const color = colors[level as keyof typeof colors] || colors.reset
    console.log(`${color}${formattedMessage.trim()}${colors.reset}`)

    // File output
    if (this.logStream) {
      this.logStream.write(formattedMessage)
    }
  }

  public info(message: string, meta?: any): void {
    this.log("info", message, meta)
  }

  public warn(message: string, meta?: any): void {
    this.log("warn", message, meta)
  }

  public error(message: string, meta?: any): void {
    this.log("error", message, meta)
  }

  public debug(message: string, meta?: any): void {
    if (process.env.NODE_ENV === "development") {
      this.log("debug", message, meta)
    }
  }
}

export const logger = new Logger()
