#!/usr/bin/env bun
import { config } from "dotenv";
import { ProtomapsStreamer } from "./protomaps-streamer.js";
import { Logger } from "./logger.js";

config();

console.log("🔍 Env var debug:");
console.log("  Endpoint:", process.env.SEAWEEDFS_ENDPOINT);
console.log("  Access key length:", process.env.SEAWEEDFS_ACCESS_KEY?.length);
console.log("  Secret key length:", process.env.SEAWEEDFS_SECRET_KEY?.length);
console.log("  Secret key first 4:", process.env.SEAWEEDFS_SECRET_KEY?.slice(0, 4));
console.log("  Secret key last 4:", process.env.SEAWEEDFS_SECRET_KEY?.slice(-4));

let isRunning = false;
let lastRun: { success: boolean; message: string; timestamp: string } | null = null;

const logger = new Logger();

async function runSync(): Promise<void> {
    if (isRunning) {
        throw new Error("Sync already in progress");
    }

    isRunning = true;
    const startTime = Date.now();

    try {
        const streamer = new ProtomapsStreamer(false);
        await streamer.run();
        
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
        lastRun = {
            success: true,
            message: `Sync completed in ${duration} minutes`,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastRun = {
            success: false,
            message: `Sync failed after ${duration} minutes: ${errorMessage}`,
            timestamp: new Date().toISOString()
        };
        throw error;
    } finally {
        isRunning = false;
    }
}

const server = Bun.serve({
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    fetch: (req) => {
        const url = new URL(req.url);
        const authToken = process.env.API_TOKEN;

        const checkAuth = () => {
            if (!authToken) return true;
            const headerToken = req.headers.get("Authorization")?.replace("Bearer ", "");
            return headerToken === authToken;
        };

        if (url.pathname === "/health" || url.pathname === "/") {
            return new Response(JSON.stringify({
                status: "healthy",
                timestamp: new Date().toISOString(),
                service: "protomaps-s3-sync"
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        if (url.pathname === "/sync" && req.method === "POST") {
            if (!checkAuth()) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" }
                });
            }

            if (isRunning) {
                return new Response(JSON.stringify({
                    error: "Sync already in progress",
                    status: "running"
                }), {
                    status: 409,
                    headers: { "Content-Type": "application/json" }
                });
            }

            runSync().catch(err => {
                logger.logError(`Background sync failed: ${err}`);
            });

            return new Response(JSON.stringify({
                message: "Sync started",
                status: "started"
            }), {
                status: 202,
                headers: { "Content-Type": "application/json" }
            });
        }

        if (url.pathname === "/status") {
            if (!checkAuth()) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" }
                });
            }

            return new Response(JSON.stringify({
                isRunning,
                lastRun
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
        });
    },
});

console.log("🗺️ Protomaps S3 Sync API Server");
console.log("=".repeat(50));
console.log(`🌐 Server running on port ${server.port}`);
console.log("📡 Endpoints:");
console.log("   GET  /health     - Health check");
console.log("   GET  /status     - Sync status (auth required)");
console.log("   POST /sync       - Trigger sync (auth required)");
console.log("=".repeat(50));

process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down gracefully...");
    server.stop();
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
    server.stop();
    process.exit(0);
});
