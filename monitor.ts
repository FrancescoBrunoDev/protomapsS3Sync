#!/usr/bin/env bun
import { $ } from "bun";

const LOG_DIR = "/workspaces/alpine/logs";
const PROGRESS_LOG = `${LOG_DIR}/transfer-progress.log`;
const RCLONE_LOG = `${LOG_DIR}/rclone-transfer.log`;
const MAIN_LOG = `${LOG_DIR}/protomaps-transfer.log`;

console.log("🖥️ Protomaps Transfer Monitor");
console.log("=".repeat(50));
console.log("Available log files:");
console.log(`📊 Progress: ${PROGRESS_LOG}`);
console.log(`🔧 Rclone:   ${RCLONE_LOG}`);
console.log(`📝 Main:     ${MAIN_LOG}`);
console.log("=".repeat(50));

const args = process.argv.slice(2);
const logType = args[0] || 'progress';

let logFile: string;
let description: string;

switch (logType.toLowerCase()) {
    case 'progress':
    case 'p':
        logFile = PROGRESS_LOG;
        description = "Transfer Progress";
        break;
    case 'rclone':
    case 'r':
        logFile = RCLONE_LOG;
        description = "Rclone Output";
        break;
    case 'main':
    case 'm':
        logFile = MAIN_LOG;
        description = "Main Log";
        break;
    default:
        console.log("Usage: bun monitor.ts [progress|rclone|main]");
        console.log("  progress (default) - Monitor transfer progress");
        console.log("  rclone            - Monitor rclone detailed output");
        console.log("  main              - Monitor main application log");
        process.exit(1);
}

console.log(`📺 Monitoring: ${description}`);
console.log(`📁 File: ${logFile}`);
console.log("Press Ctrl+C to stop");
console.log("=".repeat(50));

try {
    // Create the log file if it doesn't exist
    await $`touch ${logFile}`;

    // Start tailing the log file
    const proc = Bun.spawn(['tail', '-f', logFile], {
        stdout: 'inherit',
        stderr: 'inherit'
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        console.log("\n👋 Stopping monitor...");
        proc.kill();
        process.exit(0);
    });

    await proc.exited;
} catch (error) {
    console.error(`❌ Error monitoring log: ${error.message}`);
    process.exit(1);
}
