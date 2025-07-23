import { basename } from "path";
import type { MapBuild, BuildMetadata } from "./types.js";
import type { Logger } from "./logger.js";

export class ProtomapsClient {
    private readonly buildsApiUrl = "https://build-metadata.protomaps.dev/builds.json";
    private readonly mirrorUrls = [
        'https://r2-public.protomaps.com/protomaps-sample-datasets/planet.pmtiles',
        'https://data.source.coop/protomaps/openstreetmap/planet.pmtiles',
        'https://build.protomaps.com/planet.pmtiles',
        'https://builds.protomaps.com/planet.pmtiles'
    ];
    private readonly testUrl = 'https://r2-public.protomaps.com/protomaps-sample-datasets/terrarium-z12.pmtiles';

    constructor(private logger: Logger) {}

    async getLatestBuild(): Promise<MapBuild> {
        this.logger.log("🔍 Searching for latest Protomaps build...");

        // Strategy 1: Try to parse the builds JSON API
        try {
            const build = await this.parseBuildsPage();
            if (build) {
                this.logger.log(`✅ Found build via builds API: ${build.filename}`);
                return build;
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.log(`⚠️ Builds API parsing failed: ${errorMessage}`);
        }

        // List available builds for debugging
        await this.listAvailableBuilds();

        // Strategy 2: Try known mirror locations as fallback
        this.logger.log("🔄 Trying known mirror locations as fallback...");
        
        for (const url of this.mirrorUrls) {
            try {
                this.logger.log(`🔍 Checking mirror: ${url}...`);
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

                    this.logger.log(`✅ Found build at mirror: ${build.filename} (${build.size})`);
                    return build;
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.log(`❌ Mirror failed ${url}: ${errorMessage}`);
            }
        }

        // Strategy 3: Use test file for demonstration
        this.logger.log("⚠️ No Protomaps builds found, using test file for demonstration...");

        try {
            const response = await fetch(this.testUrl, { method: 'HEAD' });
            if (response.ok) {
                const contentLength = response.headers.get('content-length');
                const sizeGB = contentLength ? (parseInt(contentLength) / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'unknown size';

                this.logger.log(`⚠️ Using test file: terrarium-z12.pmtiles (${sizeGB})`);
                this.logger.log("⚠️ This is NOT the full planet basemap, just for testing the transfer process");

                return {
                    version: 'test-terrarium',
                    downloadUrl: this.testUrl,
                    filename: 'terrarium-z12.pmtiles',
                    size: sizeGB
                };
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.log(`❌ Test file also failed: ${errorMessage}`);
        }

        throw new Error("❌ Unable to find any Protomaps build or test file");
    }

    private async parseBuildsPage(): Promise<MapBuild | null> {
        this.logger.log(`🌐 Fetching builds metadata: ${this.buildsApiUrl}`);

        try {
            const response = await fetch(this.buildsApiUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const builds: BuildMetadata[] = await response.json();
            this.logger.log(`🔍 Found ${builds.length} builds in metadata`);

            if (!Array.isArray(builds) || builds.length === 0) {
                this.logger.log("⚠️ No builds found in metadata");
                return null;
            }

            // Sort builds by uploaded date to get the latest
            const sortedBuilds = builds.sort((a, b) => {
                const dateA = new Date(a.uploaded);
                const dateB = new Date(b.uploaded);
                return dateB.getTime() - dateA.getTime(); // Descending order (latest first)
            });

            const latestBuild = sortedBuilds[0];
            this.logger.log(`🔍 Latest build found: ${JSON.stringify(latestBuild, null, 2)}`);

            // Extract build information based on the actual JSON structure
            const filename = latestBuild.key; // The filename is in the 'key' field
            const downloadUrl = `https://build.protomaps.com/${filename}`; // Direct URL pattern
            const version = filename.replace('.pmtiles', ''); // Extract version from filename
            const sizeBytes = latestBuild.size;
            const size = (sizeBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
            const uploadedDate = new Date(latestBuild.uploaded).toISOString().split('T')[0];
            const md5sum = latestBuild.md5sum || 'not available';

            this.logger.log(`✅ Latest build details:`);
            this.logger.log(`   📦 Filename: ${filename}`);
            this.logger.log(`   📅 Upload date: ${uploadedDate}`);
            this.logger.log(`   📏 Size: ${size}`);
            this.logger.log(`   🔐 MD5: ${md5sum}`);

            if (!downloadUrl) {
                this.logger.log("⚠️ No download URL found in latest build metadata");
                return null;
            }

            // Verify the URL is accessible
            try {
                this.logger.log(`🔍 Verifying build URL: ${downloadUrl}`);
                const testResponse = await fetch(downloadUrl, { method: 'HEAD' });

                if (testResponse.ok) {
                    // Double-check file size from headers
                    const contentLength = testResponse.headers.get('content-length');
                    if (contentLength) {
                        const headerSize = (parseInt(contentLength) / 1024 / 1024 / 1024).toFixed(2) + ' GB';
                        if (headerSize !== size) {
                            this.logger.log(`🔧 Size from headers: ${headerSize} (metadata: ${size})`);
                        }
                    }

                    this.logger.log(`✅ Verified latest build: ${filename} (${version}) - ${size}`);

                    return {
                        version,
                        downloadUrl,
                        filename,
                        size
                    };
                } else {
                    this.logger.log(`⚠️ Build URL not accessible: ${downloadUrl} (HTTP ${testResponse.status})`);
                }
            } catch (verifyError: unknown) {
                const errorMessage = verifyError instanceof Error ? verifyError.message : String(verifyError);
                this.logger.log(`⚠️ Failed to verify build URL: ${errorMessage}`);
            }

            return null;

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.log(`❌ Failed to fetch builds metadata: ${errorMessage}`);
            return null;
        }
    }

    async listAvailableBuilds(): Promise<void> {
        this.logger.log("📋 Fetching all available builds...");

        try {
            const response = await fetch(this.buildsApiUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const builds: BuildMetadata[] = await response.json();

            if (!Array.isArray(builds) || builds.length === 0) {
                this.logger.log("⚠️ No builds found");
                return;
            }

            this.logger.log(`📊 Found ${builds.length} total builds:`);
            this.logger.log("=".repeat(80));

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

                this.logger.log(`📦 ${uploadDate}: ${filename} (${size}) [MD5: ${md5}]`);
            }

            if (builds.length > 10) {
                this.logger.log(`... and ${builds.length - 10} more builds`);
            }

            this.logger.log("=".repeat(80));

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.log(`❌ Failed to list builds: ${errorMessage}`);
        }
    }
}
