#!/usr/bin/env bun
import { $ } from "bun";
import { config } from "dotenv";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { basename, join } from "path";

// Load environment variables
config();

interface MapBuild {
    version: string;
    downloadUrl: string;
    filename: string;
}

class ProtomapsDownloader {
    private readonly tempDir = "/tmp/protomaps";

    constructor() {
        // Ensure temp directory exists
        if (!existsSync(this.tempDir)) {
            mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async getLatestBuild(): Promise<MapBuild> {
        console.log("🔍 Searching for latest Protomaps basemap build...");

        // Try multiple strategies to find the latest build
        const strategies = [
            this.tryDirectBuildUrl.bind(this),
            this.tryBuildPattern.bind(this),
            this.trySourceCooperative.bind(this)
        ];

        for (const strategy of strategies) {
            try {
                const result = await strategy();
                if (result) {
                    console.log(`✅ Found build: ${result.filename} (version: ${result.version})`);
                    console.log(`📍 URL: ${result.downloadUrl}`);
                    return result;
                }
            } catch (error) {
                console.log(`⚠️ Strategy failed: ${error.message}`);
            }
        }

        throw new Error("Unable to find any Protomaps build");
    }

    private async tryDirectBuildUrl(): Promise<MapBuild | null> {
        console.log("🔄 Trying direct build URL pattern...");

        // Try builds for the last 7 days
        for (let daysBack = 0; daysBack < 7; daysBack++) {
            const date = new Date();
            date.setDate(date.getDate() - daysBack);
            const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

            const url = `https://build.protomaps.com/builds/${dateStr}.pmtiles`;

            try {
                const response = await fetch(url, { method: 'HEAD' });
                if (response.ok) {
                    return {
                        version: dateStr,
                        downloadUrl: url,
                        filename: `${dateStr}.pmtiles`
                    };
                }
            } catch (e) {
                // Continue to next date
            }
        }

        return null;
    }

    private async tryBuildPattern(): Promise<MapBuild | null> {
        console.log("🔄 Trying build pattern with common dates...");

        // Try some common build patterns
        const patterns = [
            'https://build.protomaps.com/latest.pmtiles',
            'https://builds.protomaps.com/latest.pmtiles',
            'https://data.protomaps.com/builds/latest.pmtiles'
        ];

        for (const url of patterns) {
            try {
                const response = await fetch(url, { method: 'HEAD' });
                if (response.ok) {
                    return {
                        version: 'latest',
                        downloadUrl: url,
                        filename: basename(url)
                    };
                }
            } catch (e) {
                // Continue to next pattern
            }
        }

        return null;
    }

    private async trySourceCooperative(): Promise<MapBuild | null> {
        console.log("🔄 Trying Source Cooperative mirror...");

        // According to docs, there's a mirror on Source Cooperative
        // This is a placeholder - you might need to adjust based on actual API
        try {
            const url = "https://data.source.coop/protomaps/openstreetmap/planet.pmtiles";
            const response = await fetch(url, { method: 'HEAD' });
            if (response.ok) {
                return {
                    version: 'source-coop',
                    downloadUrl: url,
                    filename: 'planet.pmtiles'
                };
            }
        } catch (e) {
            // Continue
        }

        return null;
    }

    async downloadMap(build: MapBuild): Promise<string> {
        const filePath = join(this.tempDir, build.filename);

        console.log(`⬇️ Downloading ${build.filename}...`);
        console.log(`📍 URL: ${build.downloadUrl}`);

        try {
            const response = await fetch(build.downloadUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const totalBytes = parseInt(response.headers.get('content-length') || '0');
            console.log(`📦 File size: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);

            if (!response.body) {
                throw new Error("No response body");
            }

            const writer = Bun.file(filePath).writer();
            const reader = response.body.getReader();
            let downloadedBytes = 0;
            let lastProgressTime = Date.now();

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                writer.write(value);
                downloadedBytes += value.length;

                // Update progress every 5 seconds
                const now = Date.now();
                if (totalBytes > 0 && (now - lastProgressTime > 5000)) {
                    const progress = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                    const downloadedGB = (downloadedBytes / 1024 / 1024 / 1024).toFixed(2);
                    const totalGB = (totalBytes / 1024 / 1024 / 1024).toFixed(2);
                    console.log(`📊 Progress: ${progress}% (${downloadedGB}/${totalGB} GB)`);
                    lastProgressTime = now;
                }
            }

            await writer.end();
            console.log(`\n✅ Download completed: ${filePath}`);

            return filePath;
        } catch (error) {
            console.error("❌ Download failed:", error);
            throw error;
        }
    }

    async configureRclone(): Promise<void> {
        console.log("🔧 Configuring rclone for MinIO S3...");

        const endpoint = process.env.MINIO_ENDPOINT;
        const port = process.env.MINIO_PORT;
        const useSSL = process.env.MINIO_USE_SSL === 'true';
        const accessKey = process.env.MINIO_ACCESS_KEY;
        const secretKey = process.env.MINIO_SECRET_KEY;

        if (!endpoint || !accessKey || !secretKey) {
            throw new Error("Missing MinIO configuration in environment variables");
        }

        const protocol = useSSL ? 'https' : 'http';
        const fullEndpoint = port ? `${protocol}://${endpoint}:${port}` : `${protocol}://${endpoint}`;

        const configContent = `[minio]
type = s3
provider = Minio
access_key_id = ${accessKey}
secret_access_key = ${secretKey}
endpoint = ${fullEndpoint}
`;

        const configDir = `${process.env.HOME}/.config/rclone`;
        await $`mkdir -p ${configDir}`;
        await Bun.write(`${configDir}/rclone.conf`, configContent);
        console.log("✅ Rclone configured successfully");
    }

    async uploadToS3(filePath: string, build: MapBuild): Promise<void> {
        console.log(`☁️ Uploading ${build.filename} to S3 MinIO bucket 'protomaps'...`);

        try {
            // Create bucket if it doesn't exist
            await $`rclone mkdir minio:protomaps`.quiet();

            // Upload the file with progress
            const uploadResult = await $`rclone copy ${filePath} minio:protomaps/ --progress --stats=30s`;

            if (uploadResult.exitCode === 0) {
                console.log("✅ Upload completed successfully!");

                // Verify the upload
                const listResult = await $`rclone ls minio:protomaps/${build.filename}`.quiet();
                if (listResult.exitCode === 0) {
                    console.log("✅ File verified on S3 MinIO");

                    // Show all files in bucket
                    const allFiles = await $`rclone ls minio:protomaps/`.quiet();
                    console.log("📋 Current files in protomaps bucket:");
                    console.log(allFiles.stdout.toString());
                }
            } else {
                throw new Error(`rclone upload failed with exit code ${uploadResult.exitCode}`);
            }
        } catch (error) {
            console.error("❌ Upload failed:", error);
            throw error;
        }
    }

    async cleanup(filePath: string): Promise<void> {
        console.log("🧹 Cleaning up temporary files...");
        try {
            if (existsSync(filePath)) {
                unlinkSync(filePath);
                console.log("✅ Temporary file cleaned up");
            }
        } catch (error) {
            console.warn("⚠️ Warning: Failed to clean up temporary file:", error);
        }
    }

    async run(): Promise<void> {
        console.log("🚀 Starting Protomaps downloader...");
        console.log("🗺️  Looking for the latest Protomaps basemap build...");

        let downloadedFilePath: string | null = null;

        try {
            // Step 1: Configure rclone
            await this.configureRclone();

            // Step 2: Get latest build info
            const build = await this.getLatestBuild();

            // Step 3: Download the map
            downloadedFilePath = await this.downloadMap(build);

            // Step 4: Upload to S3
            await this.uploadToS3(downloadedFilePath, build);

            console.log("🎉 Process completed successfully!");
            console.log(`📋 Latest build ${build.version} is now available in your protomaps bucket`);

        } catch (error) {
            console.error("💥 Process failed:", error);
            process.exit(1);
        } finally {
            // Step 5: Cleanup
            if (downloadedFilePath) {
                await this.cleanup(downloadedFilePath);
            }
        }
    }
}

// Run the script
if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
    const downloader = new ProtomapsDownloader();
    await downloader.run();
}
