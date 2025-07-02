#!/usr/bin/env bun

// Simple logging helper
function log(level: string, message: string) {
    const timestamp = new Date().toISOString();
    const logFile = "/tmp/protomaps-transfer.log";
    const logLine = `[${timestamp}] ${level}: ${message}\n`;

    // Console output with emojis
    const emoji = {
        'INFO': '📝',
        'WARN': '⚠️',
        'ERROR': '❌',
        'SUCCESS': '✅',
        'PROGRESS': '📊'
    }[level] || '📝';

    console.log(`${emoji} ${message}`);

    // Write to log file
    try {
        require('fs').appendFileSync(logFile, logLine);
    } catch (e) {
        // Initialize log file if needed
        try {
            require('fs').writeFileSync(logFile, `=== Protomaps Transfer Log Started ===\n${logLine}`);
        } catch (e2) { }
    }
}

console.log("📝 Detailed logs will be written to: /tmp/protomaps-transfer.log");
console.log("💡 Monitor progress with: tail -f /tmp/protomaps-transfer.log");

// Test the logging
log('INFO', 'Starting Protomaps transfer script...');
log('INFO', 'Finding latest build...');

// Run the main script
const { spawn } = require('child_process');

// Start the main script and capture its output
const child = spawn('bun', ['run', 'script.ts'], {
    cwd: '/workspaces/alpine',
    stdio: ['inherit', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
    const output = data.toString().trim();
    console.log(output);
    log('INFO', `Script output: ${output}`);
});

child.stderr.on('data', (data) => {
    const output = data.toString().trim();
    console.error(output);
    log('ERROR', `Script error: ${output}`);
});

child.on('close', (code) => {
    if (code === 0) {
        log('SUCCESS', 'Transfer completed successfully!');
    } else {
        log('ERROR', `Transfer failed with exit code ${code}`);
    }
});
