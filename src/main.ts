#!/usr/bin/env bun
import { config } from "dotenv";
import { ProtomapsStreamer } from "./protomaps-streamer.js";

// Load environment variables
config();

// DEPRECATED: Use 'bun run start' for health server only, or 'bun run updateMap' for sync
if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
    console.log("⚠️  DEPRECATED: This script will run both health server AND sync");
    console.log("🏥 For health server only: bun run start");
    console.log("🗺️ For map sync only: bun run updateMap");
    console.log("=".repeat(60));
    console.log("📊 Monitor progress: tail -f /workspaces/alpine/logs/transfer-progress.log");
    console.log("🔧 Monitor rclone:   tail -f /workspaces/alpine/logs/rclone-transfer.log");
    console.log("📝 Full logs:       tail -f /workspaces/alpine/logs/protomaps-transfer.log");
    console.log("🏥 Health check:    http://localhost/health");
    console.log("=".repeat(60));

    const streamer = new ProtomapsStreamer(true); // Start health server
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down gracefully...');
        streamer.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
        streamer.stop();
        process.exit(0);
    });

    await streamer.run();
}
