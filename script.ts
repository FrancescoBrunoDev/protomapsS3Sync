#!/usr/bin/env bun
import { $ } from "bun";
import { basename } from "path";
import { config } from "dotenv";
import { appendFileSync, existsSync, mkdirSync } from "fs";

// Load environment variables
config();

// Setup logging
const LOG_DIR = "/workspaces/alpine/logs";
const MAIN_LOG = `${LOG_DIR}/protomaps-transfer.log`;
const RCLONE_LOG = `${LOG_DIR}/rclone-transfer.log`;
const PROGRESS_LOG = `${LOG_DIR}/transfer-progress.log`;

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
}

function logToFile(message: string, logFile: string = MAIN_LOG): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    appendFileSync(logFile, logEntry);
}

function log(message: string): void {
    console.log(message);
    logToFile(message);
}

function logProgress(message: string): void {
    console.log(message);
    logToFile(message, PROGRESS_LOG);
    logToFile(message);
}

interface MapBuild {
    version: string;
    downloadUrl: string;
    filename: string;
    size?: string;
}

class ProtomapsStreamer {
    private readonly maxRetries = 3;
    private readonly retryDelayMs = 5000;
    private currentFilePath: string = '';

    constructor() {
        log("🚀 Initializing Protomaps Streamer");
        log(`📁 Logs will be written to: ${LOG_DIR}`);
        log(`📊 Monitor progress with: tail -f ${PROGRESS_LOG}`);
        log(`🔧 Monitor rclone output with: tail -f ${RCLONE_LOG}`);
    }

    async getLatestBuild(): Promise<MapBuild> {
        log("🔍 Searching for latest Protomaps build...");

        // Strategy 1: Try to parse the builds JSON API
        try {
            const build = await this.parseBuildsPage();
            if (build) {
                log(`✅ Found build via builds API: ${build.filename}`);
                return build;
            }
        } catch (error) {
            log(`⚠️ Builds API parsing failed: ${error.message}`);
        }

        // List available builds for debugging
        await this.listAvailableBuilds();

        // Strategy 2: Try known mirror locations as fallback
        log("🔄 Trying known mirror locations as fallback...");
        const mirrorUrls = [
            'https://r2-public.protomaps.com/protomaps-sample-datasets/planet.pmtiles',
            'https://data.source.coop/protomaps/openstreetmap/planet.pmtiles',
            'https://build.protomaps.com/planet.pmtiles',
            'https://builds.protomaps.com/planet.pmtiles'
        ];

        for (const url of mirrorUrls) {
            try {
                log(`🔍 Checking mirror: ${url}...`);
                const response = await fetch(url, { method: 'HEAD' });

                if (response.ok) {
                    const contentLength = response.headers.get('content-length');
                    const sizeGB = contentLength ? (parseInt(contentLength) / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'unknown size';

                    const build = {
                        version: 'latest',
                        downloadUrl: url,
                        filename: basename(url),
                        size: sizeGB
                    };

                    log(`✅ Found build at mirror: ${build.filename} (${build.size})`);
                    return build;
                }
            } catch (error) {
                log(`❌ Mirror failed ${url}: ${error.message}`);
            }
        }

        // Strategy 3: Use test file for demonstration
        log("⚠️ No Protomaps builds found, using test file for demonstration...");
        const testUrl = 'https://r2-public.protomaps.com/protomaps-sample-datasets/terrarium-z12.pmtiles';

        try {
            const response = await fetch(testUrl, { method: 'HEAD' });
            if (response.ok) {
                const contentLength = response.headers.get('content-length');
                const sizeGB = contentLength ? (parseInt(contentLength) / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'unknown size';

                log(`⚠️ Using test file: terrarium-z12.pmtiles (${sizeGB})`);
                log("⚠️ This is NOT the full planet basemap, just for testing the transfer process");

                return {
                    version: 'test-terrarium',
                    downloadUrl: testUrl,
                    filename: 'terrarium-z12.pmtiles',
                    size: sizeGB
                };
            }
        } catch (error) {
            log(`❌ Test file also failed: ${error.message}`);
        }

        throw new Error("❌ Unable to find any Protomaps build or test file");
    }

    private async parseBuildsPage(): Promise<MapBuild | null> {
        log("🌐 Fetching builds metadata: https://build-metadata.protomaps.dev/builds.json");

        try {
            const response = await fetch("https://build-metadata.protomaps.dev/builds.json");

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const builds = await response.json();
            log(`🔍 Found ${builds.length} builds in metadata`);

            if (!Array.isArray(builds) || builds.length === 0) {
                log("⚠️ No builds found in metadata");
                return null;
            }

            // Sort builds by uploaded date to get the latest
            const sortedBuilds = builds.sort((a, b) => {
                const dateA = new Date(a.uploaded);
                const dateB = new Date(b.uploaded);
                return dateB.getTime() - dateA.getTime(); // Descending order (latest first)
            });

            const latestBuild = sortedBuilds[0];
            log(`🔍 Latest build found: ${JSON.stringify(latestBuild, null, 2)}`);

            // Extract build information based on the actual JSON structure
            const filename = latestBuild.key; // The filename is in the 'key' field
            const downloadUrl = `https://build.protomaps.com/${filename}`; // Direct URL pattern
            const version = filename.replace('.pmtiles', ''); // Extract version from filename
            const sizeBytes = latestBuild.size;
            const size = (sizeBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
            const uploadedDate = new Date(latestBuild.uploaded).toISOString().split('T')[0];
            const md5sum = latestBuild.md5sum || 'not available';

            log(`✅ Latest build details:`);
            log(`   📦 Filename: ${filename}`);
            log(`   📅 Upload date: ${uploadedDate}`);
            log(`   📏 Size: ${size}`);
            log(`   🔐 MD5: ${md5sum}`);

            if (!downloadUrl) {
                log("⚠️ No download URL found in latest build metadata");
                return null;
            }

            // Verify the URL is accessible
            try {
                log(`🔍 Verifying build URL: ${downloadUrl}`);
                const testResponse = await fetch(downloadUrl, { method: 'HEAD' });

                if (testResponse.ok) {
                    // Double-check file size from headers
                    const contentLength = testResponse.headers.get('content-length');
                    if (contentLength) {
                        const headerSize = (parseInt(contentLength) / 1024 / 1024 / 1024).toFixed(2) + ' GB';
                        if (headerSize !== size) {
                            log(`🔧 Size from headers: ${headerSize} (metadata: ${size})`);
                        }
                    }

                    log(`✅ Verified latest build: ${filename} (${version}) - ${size}`);

                    return {
                        version,
                        downloadUrl,
                        filename,
                        size
                    };
                } else {
                    log(`⚠️ Build URL not accessible: ${downloadUrl} (HTTP ${testResponse.status})`);
                }
            } catch (verifyError) {
                log(`⚠️ Failed to verify build URL: ${verifyError.message}`);
            }

            return null;

        } catch (error) {
            log(`❌ Failed to fetch builds metadata: ${error.message}`);
            return null;
        }
    }

    async configureRclone(): Promise<void> {
        log("🔧 Configuring rclone...");

        const endpoint = process.env.MINIO_ENDPOINT;
        const port = process.env.MINIO_PORT;
        const useSSL = process.env.MINIO_USE_SSL === 'true';
        const accessKey = process.env.MINIO_ACCESS_KEY;
        const secretKey = process.env.MINIO_SECRET_KEY;
        const bucketName = process.env.MINIO_BUCKET || 'protomaps';

        if (!endpoint || !accessKey || !secretKey) {
            throw new Error("❌ Missing MinIO configuration in environment variables");
        }

        log(`🔗 MinIO Endpoint: ${endpoint}${port ? ':' + port : ''}`);
        log(`🪣 Target Bucket: ${bucketName}`);

        const protocol = useSSL ? 'https' : 'http';
        const fullEndpoint = port ? `${protocol}://${endpoint}:${port}` : `${protocol}://${endpoint}`;

        const configContent = `[minio]
type = s3
provider = Minio
access_key_id = ${accessKey}
secret_access_key = ${secretKey}
endpoint = ${fullEndpoint}

[http]
type = http
url = PLACEHOLDER_URL
`;

        const configDir = `${process.env.HOME}/.config/rclone`;

        try {
            await $`mkdir -p ${configDir}`;
            await Bun.write(`${configDir}/rclone.conf`, configContent);
            log("✅ Rclone base configuration written");

            // Test MinIO connection with a longer timeout and better error handling
            log("🔍 Testing MinIO connection...");
            try {
                const testResult = await $`rclone lsd minio: --timeout=60s --retries=1`.quiet();

                if (testResult.exitCode === 0) {
                    log("✅ MinIO connection successful");
                } else {
                    log("⚠️ MinIO connection test failed, will try during bucket creation...");
                    log(`🔧 Test exit code: ${testResult.exitCode}`);
                    if (testResult.stderr) {
                        log(`🔧 Test error: ${testResult.stderr.toString().trim()}`);
                    }
                }
            } catch (testError) {
                log(`⚠️ MinIO connection test error: ${testError.message}`);
                log("⚠️ Will proceed and try during actual operations...");
            }

            // Ensure bucket exists
            log(`🪣 Ensuring bucket '${bucketName}' exists...`);
            try {
                const mkdirResult = await $`rclone mkdir minio:${bucketName} --timeout=60s`.quiet();
                if (mkdirResult.exitCode === 0) {
                    log(`✅ Bucket '${bucketName}' ready`);
                } else {
                    log(`⚠️ Bucket creation returned exit code ${mkdirResult.exitCode}, but continuing...`);
                    if (mkdirResult.stderr) {
                        log(`🔧 Bucket creation error: ${mkdirResult.stderr.toString().trim()}`);
                    }
                }
            } catch (bucketError) {
                log(`⚠️ Bucket creation error: ${bucketError.message}`);
                log("⚠️ Will proceed anyway - bucket might already exist");
            }

        } catch (error) {
            log(`❌ Rclone configuration failed: ${error.message}`);
            throw error;
        }
    }

    private async updateHttpRemote(url: string): Promise<void> {
        log(`🔄 Updating HTTP remote for URL: ${url}`);

        const configDir = `${process.env.HOME}/.config/rclone`;
        const configPath = `${configDir}/rclone.conf`;

        try {
            // Parse the URL to get the base URL and file path
            const urlObj = new URL(url);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
            const filePath = urlObj.pathname;

            log(`🔧 Base URL: ${baseUrl}`);
            log(`🔧 File path: ${filePath}`);

            const currentConfig = await Bun.file(configPath).text();
            const updatedConfig = currentConfig.replace('url = PLACEHOLDER_URL', `url = ${baseUrl}`);
            await Bun.write(configPath, updatedConfig);
            log("✅ HTTP remote configuration updated");

            // Store the file path for use in the transfer
            this.currentFilePath = filePath;

        } catch (error) {
            log(`❌ Failed to update HTTP remote: ${error.message}`);
            throw error;
        }
    }

    async streamToS3(build: MapBuild): Promise<void> {
        const bucketName = process.env.MINIO_BUCKET || 'protomaps';
        const remotePath = `minio:${bucketName}/${build.filename}`;

        log(`☁️ Starting direct stream from HTTP to S3...`);
        log(`📍 Source: ${build.downloadUrl}`);
        log(`🎯 Destination: ${remotePath}`);
        log(`📦 File: ${build.filename} ${build.size ? `(${build.size})` : ''}`);

        // Update HTTP remote configuration
        await this.updateHttpRemote(build.downloadUrl);

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            log(`🔄 Transfer attempt ${attempt}/${this.maxRetries}`);
            logProgress(`🔄 Starting transfer attempt ${attempt}/${this.maxRetries}`);

            try {
                // Check if partial file exists and clean it up
                const checkResult = await $`rclone ls ${remotePath}`.quiet();
                if (checkResult.exitCode === 0) {
                    log("🗑️ Removing existing partial file...");
                    await $`rclone delete ${remotePath}`.quiet();
                    log("✅ Existing file removed");
                }

                log("🚀 Starting rclone transfer...");
                logProgress("🚀 Transfer started - monitoring rclone output...");

                // Use rclone copyto for direct streaming with detailed progress
                const httpSource = `http:${this.currentFilePath}`;
                const rcloneCmd = [
                    'rclone', 'copyto',
                    httpSource,
                    remotePath,
                    '--progress',
                    '--stats=10s',
                    '--stats-log-level=INFO',
                    '--log-file=' + RCLONE_LOG,
                    '--log-level=INFO',
                    '--retries=3',
                    '--low-level-retries=10',
                    '--timeout=0',
                    '--contimeout=60s',
                    '--expect-continue-timeout=5s'
                ];

                log(`🔧 Running: ${rcloneCmd.join(' ')}`);
                log(`🔧 HTTP source: ${httpSource}`);

                const proc = Bun.spawn(rcloneCmd, {
                    stdout: 'pipe',
                    stderr: 'pipe'
                });

                // Monitor progress in real-time
                const decoder = new TextDecoder();
                let buffer = '';

                if (proc.stdout) {
                    for await (const chunk of proc.stdout) {
                        const text = decoder.decode(chunk);
                        buffer += text;

                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.trim()) {
                                logProgress(`📊 ${line.trim()}`);
                            }
                        }
                    }
                }

                const exitCode = await proc.exited;

                if (exitCode === 0) {
                    log("✅ Transfer completed successfully!");
                    logProgress("✅ Transfer completed successfully!");

                    // Verify the upload
                    log("🔍 Verifying uploaded file...");
                    const verifyResult = await $`rclone ls ${remotePath}`.quiet();

                    if (verifyResult.exitCode === 0) {
                        const fileInfo = verifyResult.stdout.toString().trim();
                        log(`✅ File verified: ${fileInfo}`);
                        logProgress(`✅ File verified: ${fileInfo}`);

                        // Show final bucket contents
                        log("📋 Final bucket contents:");
                        const listResult = await $`rclone ls minio:${bucketName}/`.quiet();
                        if (listResult.exitCode === 0) {
                            log(listResult.stdout.toString());
                        }

                        return; // Success!
                    } else {
                        throw new Error("File verification failed");
                    }

                } else {
                    // Read stderr for error details
                    let errorOutput = '';
                    if (proc.stderr) {
                        errorOutput = decoder.decode(await Bun.readableStreamToArrayBuffer(proc.stderr));
                    }
                    throw new Error(`rclone failed with exit code ${exitCode}: ${errorOutput}`);
                }

            } catch (error) {
                log(`❌ Attempt ${attempt} failed: ${error.message}`);
                logProgress(`❌ Attempt ${attempt} failed: ${error.message}`);

                if (attempt < this.maxRetries) {
                    const delay = this.retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
                    log(`⏳ Waiting ${delay}ms before retry...`);
                    logProgress(`⏳ Waiting ${delay}ms before retry...`);
                    await Bun.sleep(delay);

                    // Clean up any partial uploads before retry
                    log("🗑️ Cleaning up partial uploads...");
                    await $`rclone delete ${remotePath}`.quiet();
                } else {
                    log("💥 All retry attempts exhausted");
                    logProgress("💥 All retry attempts exhausted");
                    throw error;
                }
            }
        }
    }

    async listAvailableBuilds(): Promise<void> {
        log("📋 Fetching all available builds...");

        try {
            const response = await fetch("https://build-metadata.protomaps.dev/builds.json");

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const builds = await response.json();

            if (!Array.isArray(builds) || builds.length === 0) {
                log("⚠️ No builds found");
                return;
            }

            log(`📊 Found ${builds.length} total builds:`);
            log("=".repeat(80));

            // Sort builds by upload date (latest first)
            const sortedBuilds = builds.sort((a, b) => {
                const dateA = new Date(a.uploaded);
                const dateB = new Date(b.uploaded);
                return dateB.getTime() - dateA.getTime();
            });

            // Show the latest 10 builds
            const recentBuilds = sortedBuilds.slice(0, 10);

            for (const build of recentBuilds) {
                const filename = build.key;
                const version = filename.replace('.pmtiles', '');
                const size = (build.size / 1024 / 1024 / 1024).toFixed(2) + ' GB';
                const uploadDate = new Date(build.uploaded).toISOString().split('T')[0];
                const md5 = build.md5sum ? build.md5sum.substring(0, 8) + '...' : 'N/A';

                log(`📦 ${uploadDate}: ${filename} (${size}) [MD5: ${md5}]`);
            }

            if (builds.length > 10) {
                log(`... and ${builds.length - 10} more builds`);
            }

            log("=".repeat(80));

        } catch (error) {
            log(`❌ Failed to list builds: ${error.message}`);
        }
    }

    async run(): Promise<void> {
        const startTime = Date.now();
        log("🚀 Starting Protomaps to S3 streaming process...");
        log("=".repeat(60));

        try {
            // Step 1: Configure rclone
            await this.configureRclone();

            // Step 2: Find latest build
            const build = await this.getLatestBuild();
            log(`🎯 Target: ${build.filename} (version: ${build.version})`);

            // Step 3: Stream directly to S3
            await this.streamToS3(build);

            const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
            log("=".repeat(60));
            log(`🎉 Process completed successfully in ${duration} minutes!`);
            log(`📋 ${build.filename} is now available in your S3 bucket`);
            logProgress(`🎉 Process completed successfully in ${duration} minutes!`);

        } catch (error) {
            const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
            log("=".repeat(60));
            log(`💥 Process failed after ${duration} minutes: ${error.message}`);
            logProgress(`💥 Process failed after ${duration} minutes: ${error.message}`);

            // Log error details
            if (error.stack) {
                logToFile(`Stack trace: ${error.stack}`);
            }

            process.exit(1);
        }
    }
}

// Run the script
if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
    console.log("🗺️ Protomaps S3 Streaming Transfer");
    console.log("=".repeat(60));
    console.log("📊 Monitor progress: tail -f /workspaces/alpine/logs/transfer-progress.log");
    console.log("🔧 Monitor rclone:   tail -f /workspaces/alpine/logs/rclone-transfer.log");
    console.log("📝 Full logs:       tail -f /workspaces/alpine/logs/protomaps-transfer.log");
    console.log("=".repeat(60));

    const streamer = new ProtomapsStreamer();
    await streamer.run();
}
