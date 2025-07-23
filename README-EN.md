# Protomaps S3 Sync

A modular TypeScript application that downloads the latest Protomaps basemap and streams it directly to S3-compatible storage (MinIO) using rclone.

## 🏗️ Architecture

The project has been refactored into a clean, modular structure:

```
src/
├── server.ts            # Health check server only
├── update-maps.ts       # Map synchronization script
├── main.ts              # Legacy entry point (deprecated)
├── types.ts             # TypeScript interfaces and types
├── logger.ts            # Centralized logging system
├── health-server.ts     # HTTP health check server component
├── protomaps-client.ts  # Protomaps API client
├── rclone-manager.ts    # Rclone operations and S3 streaming
└── protomaps-streamer.ts # Main orchestration logic
```

## 🚀 Features

- **Modular Design**: Clean separation of concerns across multiple files
- **Separate Health Server**: Health check server runs independently from sync process
- **Health Check**: HTTP endpoint for container monitoring (port 80, fallback to 8080, 3000, etc.)
- **On-Demand Sync**: Map synchronization runs only when explicitly requested
- **Robust Error Handling**: Retry logic with exponential backoff
- **Comprehensive Logging**: Progress monitoring and detailed logs
- **Graceful Shutdown**: Proper cleanup on SIGINT/SIGTERM
- **Direct Streaming**: Memory-efficient streaming from HTTP to S3

## 📋 Prerequisites

- Bun runtime
- rclone installed and configured
- MinIO/S3 credentials in environment variables

## 🔧 Environment Variables

```bash
MINIO_ENDPOINT=your-minio-endpoint.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET=protomaps
```

## 🏃 Usage

```bash
# Start health check server only
bun run start

# Sync/Update protomaps (one-time operation)
bun run updateMap
# or alternatively:
bun run sync

# Development mode - health server with auto-reload
bun run dev:server

# Development mode - sync with auto-reload  
bun run dev:sync

# Monitor progress
bun run logs:tail

# Clear logs
bun run logs:clear
```

## 📊 Monitoring

- **Progress**: `tail -f /workspaces/alpine/logs/transfer-progress.log`
- **Rclone**: `tail -f /workspaces/alpine/logs/rclone-transfer.log`
- **Main**: `tail -f /workspaces/alpine/logs/protomaps-transfer.log`
- **Health**: `curl http://localhost:8080/health`

## 🏥 Health Check

The application includes an HTTP health check server that:
- Starts on port 80 (falls back to 8080, 3000, 8000, 9000 if busy)
- Returns 200 OK with JSON status on `/health` and `/`
- Runs independently from the map synchronization process
- Useful for container orchestration and monitoring

Example response:
```json
{
  "status": "healthy",
  "timestamp": "2025-07-23T10:30:00.000Z",
  "service": "protomaps-s3-sync"
}
```

## 🔄 Workflow

### Typical Usage Pattern:
1. **Start the health server**: `bun run start` - Keeps running for health checks
2. **Update maps when needed**: `bun run updateMap` - Runs once and exits
3. **Schedule updates**: Use cron, systemd timers, or K8s CronJobs to run `updateMap` periodically

### Container Deployment:
- Main container: `bun run start` (always running for health checks)
- Sync job: `bun run updateMap` (runs as needed, e.g., daily/weekly)

## 📖 Documentation

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed information about the modular structure and design decisions.

## 🔄 Migration from Original Script

The original `script.ts` has been split into multiple focused modules. The functionality remains the same, but the code is now:
- Easier to test and maintain
- More modular and reusable
- Better organized with clear separation of concerns
- Includes graceful shutdown handling
