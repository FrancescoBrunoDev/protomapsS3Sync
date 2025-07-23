#!/usr/bin/env bun
import { config } from "dotenv";
import { ProtomapsStreamer } from "./protomaps-streamer.js";

// Load environment variables
config();

// Map synchronization script
if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
    console.log("🗺️ Protomaps S3 Map Update");
    console.log("=".repeat(60));
    console.log("📊 Monitor progress: tail -f /workspaces/alpine/logs/transfer-progress.log");
    console.log("🔧 Monitor rclone:   tail -f /workspaces/alpine/logs/rclone-transfer.log");
    console.log("📝 Full logs:       tail -f /workspaces/alpine/logs/protomaps-transfer.log");
    console.log("=".repeat(60));

    const streamer = new ProtomapsStreamer(false); // false = don't start health server
    
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
