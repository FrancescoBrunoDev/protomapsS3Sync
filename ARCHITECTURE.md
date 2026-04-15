# Project Structure

This project has been refactored into smaller, more manageable files:

## Directory Structure

```
src/
├── server.ts            # Health check server entry point
├── update-maps.ts       # Map synchronization entry point  
├── main.ts              # Legacy entry point (deprecated)
├── types.ts             # TypeScript type definitions
├── logger.ts            # Centralized logging functionality
├── health-server.ts     # Health check HTTP server (port 80)
├── protomaps-client.ts  # Protomaps API client and build discovery
├── rclone-manager.ts    # Rclone configuration and S3 streaming operations
└── protomaps-streamer.ts # Main orchestration class
```

## File Descriptions

### `src/server.ts`
- Health check server entry point
- Runs only the HTTP health endpoint
- Keeps the process alive for container health checks
- Handles graceful shutdown

### `src/update-maps.ts`
- Map synchronization entry point
- Runs the complete map sync process
- Exits when sync is complete
- Does not start health server

### `src/main.ts` (DEPRECATED)
- Legacy entry point that runs both health server and sync
- Kept for backwards compatibility
- New deployments should use `server.ts` and `update-maps.ts`

### `src/types.ts`
- Contains all TypeScript interfaces and types
- `MapBuild` - Represents a Protomaps build
- `BuildMetadata` - API response structure
- `SeaweedFSConfig` - SeaweedFS connection configuration

### `src/logger.ts`
- Centralized logging system
- Handles file and console logging
- Progress logging for monitoring
- Log file management

### `src/health-server.ts`
- HTTP health check server
- Returns 200 OK on `/health` and `/` endpoints
- JSON response with service status
- Graceful start/stop functionality

### `src/protomaps-client.ts`
- Protomaps build discovery
- API client for build metadata
- Mirror URL fallback logic
- Build verification and listing

### `src/rclone-manager.ts`
- Rclone configuration management
- HTTP remote setup
- S3 streaming operations
- Retry logic with exponential backoff

### `src/protomaps-streamer.ts`
- Main orchestration class
- Coordinates all components
- Handles the complete streaming workflow
- Error handling and logging

## Benefits of This Structure

1. **Separation of Concerns** - Each file has a specific responsibility
2. **Service vs Job Pattern** - Health server runs continuously, sync runs on-demand
3. **Container-Friendly** - Health server for main container, sync for scheduled jobs
4. **Testability** - Individual components can be tested in isolation
5. **Maintainability** - Easier to find and modify specific functionality
6. **Reusability** - Components can be reused in other projects
7. **Readability** - Smaller files are easier to understand
8. **Operational Flexibility** - Can scale health checks and sync operations independently

## Usage

```bash
# Start health check server only (for containers/long-running services)
bun run start

# Sync/Update protomaps (one-time operation, for cron jobs/scheduled tasks)
bun run updateMap

# Development modes
bun run dev:server    # Health server with auto-reload
bun run dev:sync      # Sync with auto-reload

# Monitor logs
bun run logs:tail
```

## Health Check

The application now includes a health check server on port 80:
- `GET /health` - Returns JSON status
- `GET /` - Same as `/health`

This is useful for container orchestration and monitoring systems.
