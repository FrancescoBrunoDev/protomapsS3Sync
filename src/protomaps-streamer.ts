import type { MapBuild, SeaweedFSConfig } from "./types.js";
import { Logger } from "./logger.js";
import { HealthServer } from "./health-server.js";
import { ProtomapsClient } from "./protomaps-client.js";
import { S3Manager } from "./s3-manager.js";

export class ProtomapsStreamer {
    private readonly maxRetries = 3;
    private readonly retryDelayMs = 5000;

    private logger: Logger;
    private healthServer: HealthServer;
    private protomapsClient: ProtomapsClient;
    private s3Manager: S3Manager | null = null;

    constructor(startHealthServer: boolean = true) {
        this.logger = new Logger();
        this.healthServer = new HealthServer(this.logger);
        this.protomapsClient = new ProtomapsClient(this.logger);

        const logPaths = this.logger.getLogPaths();

        this.logger.log("🚀 Initializing Protomaps Streamer");
        this.logger.log(`📁 Logs will be written to: ${logPaths.dir}`);
        this.logger.log(`📊 Monitor progress with: tail -f ${logPaths.progress}`);

        if (startHealthServer) {
            this.healthServer.start(80);
        }
    }

    private getSeaweedFSConfig(): SeaweedFSConfig {
        const endpoint = process.env.SEAWEEDFS_ENDPOINT;
        const accessKey = process.env.SEAWEEDFS_ACCESS_KEY;
        const secretKey = process.env.SEAWEEDFS_SECRET_KEY;
        const bucket = process.env.SEAWEEDFS_BUCKET || 'protomaps';

        if (!endpoint || !accessKey || !secretKey) {
            throw new Error("❌ Missing SeaweedFS configuration in environment variables");
        }

        return {
            endpoint,
            accessKey,
            secretKey,
            bucket
        };
    }

    async run(): Promise<void> {
        const startTime = Date.now();
        this.logger.log("🚀 Starting Protomaps to S3 streaming process...");
        this.logger.log("=".repeat(60));

        try {
            const config = this.getSeaweedFSConfig();

            this.s3Manager = new S3Manager(
                config.endpoint,
                config.accessKey,
                config.secretKey,
                config.bucket,
                this.logger
            );

            const buckets = await this.s3Manager.listBuckets();
            this.logger.log(`📋 Available buckets: ${buckets.join(", ") || "none"}`);

            const build = await this.protomapsClient.getLatestBuild();
            this.logger.log(`🎯 Target: ${build.filename} (version: ${build.version})`);

            await this.s3Manager.uploadFromUrl(build.downloadUrl, build.filename);

            const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
            this.logger.log("=".repeat(60));
            this.logger.log(`🎉 Process completed successfully in ${duration} minutes!`);
            this.logger.log(`📋 ${build.filename} is now available in your S3 bucket`);
            this.logger.logProgress(`🎉 Process completed successfully in ${duration} minutes!`);

        } catch (error) {
            const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
            this.logger.log("=".repeat(60));

            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.log(`💥 Process failed after ${duration} minutes: ${errorMessage}`);
            this.logger.logProgress(`💥 Process failed after ${duration} minutes: ${errorMessage}`);

            if (error instanceof Error && error.stack) {
                this.logger.logError(`Stack trace: ${error.stack}`);
            }

            process.exit(1);
        }
    }

    stop(): void {
        this.healthServer.stop();
    }
}
