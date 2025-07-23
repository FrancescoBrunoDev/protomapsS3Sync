#!/usr/bin/env bun
import { config } from "dotenv";
import { Logger } from "./logger.js";
import { HealthServer } from "./health-server.js";

// Load environment variables
config();

// Health check server only
if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
    console.log("🏥 Protomaps S3 Sync - Health Server");
    console.log("=".repeat(50));
    console.log("🔍 Starting health check server only...");
    console.log("🗺️ To sync maps, run: bun run updateMap");
    console.log("=".repeat(50));

    const logger = new Logger();
    const healthServer = new HealthServer(logger);
    
    // Start health check server
    healthServer.start(80);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down health server gracefully...');
        healthServer.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\n🛑 Received SIGTERM, shutting down health server gracefully...');
        healthServer.stop();
        process.exit(0);
    });

    // Keep the process alive
    console.log("✅ Health server is running. Press Ctrl+C to stop.");
    
    // Prevent the process from exiting
    setInterval(() => {
        // Do nothing, just keep alive
    }, 60000);
}
