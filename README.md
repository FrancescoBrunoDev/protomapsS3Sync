# Protomaps S3 Streaming Transfer

This script automates the process of downloading the latest Protomaps build and uploading it directly to a MinIO S3 bucket using rclone, with robust error handling, resumable transfers, and detailed logging.

## Features

- 🌐 **Direct Streaming**: Transfers files directly from HTTP to S3 without local storage
- 📊 **Detailed Logging**: Multiple log files for different aspects of the transfer
- 🔄 **Retry Logic**: Automatic retries with exponential backoff
- 📈 **Progress Monitoring**: Real-time transfer progress and statistics
- 🧹 **Cleanup**: Automatic cleanup of partial uploads on failure
- 🛡️ **Error Handling**: Comprehensive error handling and recovery

## Prerequisites

1. **Bun runtime** installed
2. **rclone** installed (automatically installed in devcontainer)
3. **MinIO S3 credentials** configured in `.env` file

## Setup

1. Create a `.env` file with your MinIO credentials:

```env
MINIO_ENDPOINT=your-minio-endpoint.com
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET=protomaps
```

2. Install dependencies:

```bash
bun install
```

## Usage

### Basic Usage

Run the main transfer script:

```bash
bun script.ts
```

### Monitoring Progress

The script creates detailed logs in the `/workspaces/alpine/logs/` directory:

- **`transfer-progress.log`** - High-level progress updates
- **`rclone-transfer.log`** - Detailed rclone output with transfer statistics
- **`protomaps-transfer.log`** - Complete application log

#### Monitor in Real-time

Use the monitoring helper to watch progress:

```bash
# Monitor transfer progress (default)
bun monitor.ts

# Monitor detailed rclone output
bun monitor.ts rclone

# Monitor main application log
bun monitor.ts main
```

#### Manual Monitoring

You can also monitor logs directly:

```bash
# Watch transfer progress
tail -f logs/transfer-progress.log

# Watch rclone detailed output
tail -f logs/rclone-transfer.log

# Watch main application log
tail -f logs/protomaps-transfer.log
```

## How It Works

1. **Discovery**: The script searches for the latest Protomaps build by:
   - Parsing the builds page at https://maps.protomaps.com/builds/
   - Falling back to date-based URL detection (last 14 days)

2. **Configuration**: 
   - Configures rclone with MinIO S3 credentials
   - Sets up HTTP remote for the source URL
   - Ensures target bucket exists

3. **Streaming Transfer**:
   - Uses `rclone copyto` to stream directly from HTTP to S3
   - No local storage required (handles 120GB+ files)
   - Real-time progress monitoring with statistics every 10 seconds

4. **Error Handling**:
   - Automatic retries (3 attempts) with exponential backoff
   - Cleanup of partial uploads on failure
   - Detailed error logging and recovery

5. **Verification**:
   - Verifies successful upload
   - Lists final bucket contents

## Log Output Examples

### Progress Log
```
[2024-01-15T10:30:00.000Z] 🔄 Starting transfer attempt 1/3
[2024-01-15T10:30:05.000Z] 📊 Transferred: 1.2 GiB / 120.5 GiB, 1%, 45.2 MiB/s, ETA 45m30s
[2024-01-15T10:30:15.000Z] 📊 Transferred: 2.8 GiB / 120.5 GiB, 2%, 52.1 MiB/s, ETA 42m15s
```

### Rclone Log
```
2024/01/15 10:30:00 INFO  : Starting transfer of 20240115.pmtiles
2024/01/15 10:30:05 INFO  : 20240115.pmtiles: 1% done, 45.2 MiB/s, ETA 45m30s
2024/01/15 10:30:15 INFO  : 20240115.pmtiles: 2% done, 52.1 MiB/s, ETA 42m15s
```

## Error Recovery

The script includes robust error recovery:

- **Network Issues**: Automatic retries with exponential backoff
- **Partial Uploads**: Cleanup and restart from beginning
- **Configuration Errors**: Clear error messages and validation
- **MinIO Issues**: Connection testing and bucket creation

## Testing

Test your S3 configuration with a small file:

```bash
bun test-script.ts
```

## Troubleshooting

### Common Issues

1. **MinIO Connection Failed**
   - Check your `.env` file credentials
   - Verify MinIO endpoint accessibility
   - Ensure firewall/network allows connection

2. **Transfer Stalls**
   - Check network connectivity
   - Monitor rclone log for detailed error messages
   - Increase timeout values if needed

3. **Out of Space**
   - Ensure sufficient space in S3 bucket
   - Check MinIO storage quotas

### Debug Mode

For more verbose output, you can modify the rclone command in the script to include:
```bash
--log-level=DEBUG
```

## Performance Tuning

The script is optimized for large transfers:

- **Streaming**: No local storage required
- **Timeouts**: Configured for long-running transfers
- **Retries**: Multiple retry layers (rclone + application level)
- **Progress**: Regular updates without overwhelming logs

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `MINIO_ENDPOINT` | Yes | MinIO server endpoint | - |
| `MINIO_PORT` | No | MinIO server port | - |
| `MINIO_USE_SSL` | No | Use HTTPS for MinIO | false |
| `MINIO_ACCESS_KEY` | Yes | MinIO access key | - |
| `MINIO_SECRET_KEY` | Yes | MinIO secret key | - |
| `MINIO_BUCKET` | No | Target bucket name | protomaps |

## File Structure

```
/workspaces/alpine/
├── script.ts              # Main transfer script
├── monitor.ts             # Log monitoring helper
├── test-script.ts         # S3 connection test
├── .env                   # MinIO credentials
├── logs/                  # Log directory
│   ├── transfer-progress.log
│   ├── rclone-transfer.log
│   └── protomaps-transfer.log
└── README.md              # This file
```
