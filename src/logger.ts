import { appendFileSync, existsSync, mkdirSync } from "fs";

export class Logger {
    private readonly LOG_DIR = "/workspaces/alpine/logs";
    private readonly MAIN_LOG: string;
    private readonly RCLONE_LOG: string;
    private readonly PROGRESS_LOG: string;

    constructor() {
        this.MAIN_LOG = `${this.LOG_DIR}/protomaps-transfer.log`;
        this.RCLONE_LOG = `${this.LOG_DIR}/rclone-transfer.log`;
        this.PROGRESS_LOG = `${this.LOG_DIR}/transfer-progress.log`;

        // Ensure log directory exists
        if (!existsSync(this.LOG_DIR)) {
            mkdirSync(this.LOG_DIR, { recursive: true });
        }
    }

    private logToFile(message: string, logFile: string = this.MAIN_LOG): void {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        appendFileSync(logFile, logEntry);
    }

    public logError(message: string): void {
        this.logToFile(message);
    }

    log(message: string): void {
        console.log(message);
        this.logToFile(message);
    }

    logProgress(message: string): void {
        console.log(message);
        this.logToFile(message, this.PROGRESS_LOG);
        this.logToFile(message);
    }

    logToRclone(message: string): void {
        this.logToFile(message, this.RCLONE_LOG);
    }

    getLogPaths() {
        return {
            main: this.MAIN_LOG,
            rclone: this.RCLONE_LOG,
            progress: this.PROGRESS_LOG,
            dir: this.LOG_DIR
        };
    }
}
