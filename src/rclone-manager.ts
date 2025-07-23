import { $ } from "bun";
import type { MinIOConfig } from "./types.js";
import type { Logger } from "./logger.js";

export class RcloneManager {
    private currentFilePath: string = '';

    constructor(private logger: Logger) {}

    async configure(config: MinIOConfig): Promise<void> {
        this.logger.log("🔧 Configuring rclone...");

        this.logger.log(`🔗 MinIO Endpoint: ${config.endpoint}${config.port ? ':' + config.port : ''}`);
        this.logger.log(`🪣 Target Bucket: ${config.bucket}`);

        const protocol = config.useSSL ? 'https' : 'http';
        const fullEndpoint = config.port ? `${protocol}://${config.endpoint}:${config.port}` : `${protocol}://${config.endpoint}`;

        const configContent = `[minio]
type = s3
provider = Minio
access_key_id = ${config.accessKey}
secret_access_key = ${config.secretKey}
endpoint = ${fullEndpoint}

[http]
type = http
url = PLACEHOLDER_URL
`;

        const configDir = `${process.env.HOME}/.config/rclone`;

        try {
            await $`mkdir -p ${configDir}`;
            await Bun.write(`${configDir}/rclone.conf`, configContent);
            this.logger.log("✅ Rclone base configuration written");

            // Test MinIO connection with a longer timeout and better error handling
            this.logger.log("🔍 Testing MinIO connection...");
            try {
                const testResult = await $`rclone lsd minio: --timeout=60s --retries=1`.quiet();

                if (testResult.exitCode === 0) {
                    this.logger.log("✅ MinIO connection successful");
                } else {
                    this.logger.log("⚠️ MinIO connection test failed, will try during bucket creation...");
                    this.logger.log(`🔧 Test exit code: ${testResult.exitCode}`);
                    if (testResult.stderr) {
                        this.logger.log(`🔧 Test error: ${testResult.stderr.toString().trim()}`);
                    }
                }
            } catch (testError: unknown) {
                const errorMessage = testError instanceof Error ? testError.message : String(testError);
                this.logger.log(`⚠️ MinIO connection test error: ${errorMessage}`);
                this.logger.log("⚠️ Will proceed and try during actual operations...");
            }

            // Ensure bucket exists
            this.logger.log(`🪣 Ensuring bucket '${config.bucket}' exists...`);
            try {
                const mkdirResult = await $`rclone mkdir minio:${config.bucket} --timeout=60s`.quiet();
                if (mkdirResult.exitCode === 0) {
                    this.logger.log(`✅ Bucket '${config.bucket}' ready`);
                } else {
                    this.logger.log(`⚠️ Bucket creation returned exit code ${mkdirResult.exitCode}, but continuing...`);
                    if (mkdirResult.stderr) {
                        this.logger.log(`🔧 Bucket creation error: ${mkdirResult.stderr.toString().trim()}`);
                    }
                }
            } catch (bucketError: unknown) {
                const errorMessage = bucketError instanceof Error ? bucketError.message : String(bucketError);
                this.logger.log(`⚠️ Bucket creation error: ${errorMessage}`);
                this.logger.log("⚠️ Will proceed anyway - bucket might already exist");
            }

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.log(`❌ Rclone configuration failed: ${errorMessage}`);
            throw error;
        }
    }

    async updateHttpRemote(url: string): Promise<void> {
        this.logger.log(`🔄 Updating HTTP remote for URL: ${url}`);

        const configDir = `${process.env.HOME}/.config/rclone`;
        const configPath = `${configDir}/rclone.conf`;

        try {
            // Parse the URL to get the base URL and file path
            const urlObj = new URL(url);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
            const filePath = urlObj.pathname;

            this.logger.log(`🔧 Base URL: ${baseUrl}`);
            this.logger.log(`🔧 File path: ${filePath}`);

            const currentConfig = await Bun.file(configPath).text();
            const updatedConfig = currentConfig.replace('url = PLACEHOLDER_URL', `url = ${baseUrl}`);
            await Bun.write(configPath, updatedConfig);
            this.logger.log("✅ HTTP remote configuration updated");

            // Store the file path for use in the transfer
            this.currentFilePath = filePath;

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.log(`❌ Failed to update HTTP remote: ${errorMessage}`);
            throw error;
        }
    }

    async streamToS3(sourceUrl: string, bucketName: string, filename: string, rcloneLogPath: string, maxRetries: number = 3, retryDelayMs: number = 5000): Promise<void> {
        const remotePath = `minio:${bucketName}/${filename}`;

        this.logger.log(`☁️ Starting direct stream from HTTP to S3...`);
        this.logger.log(`📍 Source: ${sourceUrl}`);
        this.logger.log(`🎯 Destination: ${remotePath}`);
        this.logger.log(`📦 File: ${filename}`);

        // Update HTTP remote configuration
        await this.updateHttpRemote(sourceUrl);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.logger.log(`🔄 Transfer attempt ${attempt}/${maxRetries}`);
            this.logger.logProgress(`🔄 Starting transfer attempt ${attempt}/${maxRetries}`);

            try {
                // Check if partial file exists and clean it up
                const checkResult = await $`rclone ls ${remotePath}`.quiet();
                if (checkResult.exitCode === 0) {
                    this.logger.log("🗑️ Removing existing partial file...");
                    await $`rclone delete ${remotePath}`.quiet();
                    this.logger.log("✅ Existing file removed");
                }

                this.logger.log("🚀 Starting rclone transfer...");
                this.logger.logProgress("🚀 Transfer started - monitoring rclone output...");

                // Use rclone copyto for direct streaming with detailed progress
                const httpSource = `http:${this.currentFilePath}`;
                const rcloneCmd = [
                    'rclone', 'copyto',
                    httpSource,
                    remotePath,
                    '--progress',
                    '--stats=10s',
                    '--stats-log-level=INFO',
                    '--log-file=' + rcloneLogPath,
                    '--log-level=INFO',
                    '--retries=3',
                    '--low-level-retries=10',
                    '--timeout=0',
                    '--contimeout=60s',
                    '--expect-continue-timeout=5s'
                ];

                this.logger.log(`🔧 Running: ${rcloneCmd.join(' ')}`);
                this.logger.log(`🔧 HTTP source: ${httpSource}`);

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
                                this.logger.logProgress(`📊 ${line.trim()}`);
                            }
                        }
                    }
                }

                const exitCode = await proc.exited;

                if (exitCode === 0) {
                    this.logger.log("✅ Transfer completed successfully!");
                    this.logger.logProgress("✅ Transfer completed successfully!");

                    // Verify the upload
                    this.logger.log("🔍 Verifying uploaded file...");
                    const verifyResult = await $`rclone ls ${remotePath}`.quiet();

                    if (verifyResult.exitCode === 0) {
                        const fileInfo = verifyResult.stdout.toString().trim();
                        this.logger.log(`✅ File verified: ${fileInfo}`);
                        this.logger.logProgress(`✅ File verified: ${fileInfo}`);

                        // Show final bucket contents
                        this.logger.log("📋 Final bucket contents:");
                        const listResult = await $`rclone ls minio:${bucketName}/`.quiet();
                        if (listResult.exitCode === 0) {
                            this.logger.log(listResult.stdout.toString());
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

            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.log(`❌ Attempt ${attempt} failed: ${errorMessage}`);
                this.logger.logProgress(`❌ Attempt ${attempt} failed: ${errorMessage}`);

                if (attempt < maxRetries) {
                    const delay = retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
                    this.logger.log(`⏳ Waiting ${delay}ms before retry...`);
                    this.logger.logProgress(`⏳ Waiting ${delay}ms before retry...`);
                    await Bun.sleep(delay);

                    // Clean up any partial uploads before retry
                    this.logger.log("🗑️ Cleaning up partial uploads...");
                    await $`rclone delete ${remotePath}`.quiet();
                } else {
                    this.logger.log("💥 All retry attempts exhausted");
                    this.logger.logProgress("💥 All retry attempts exhausted");
                    throw error;
                }
            }
        }
    }
}
