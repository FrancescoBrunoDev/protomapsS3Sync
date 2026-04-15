import { S3Client, ListBucketsCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Logger } from "./logger.js";
import type { SeaweedFSConfig } from "./types.js";

/**
 * S3Manager - AWS SDK v3 based S3 client for SeaweedFS S3-compatible API
 *
 * Provides similar interface to RcloneManager for easy replacement.
 * Handles streaming uploads from HTTP URLs directly to S3 buckets using multipart upload.
 */
export class S3Manager {
  private client: S3Client;
  private bucket: string;
  private logger: Logger;
  private currentFilePath: string = '';
  private isConfigured: boolean = false;

  /**
   * Constructor that accepts individual parameters
   * @param endpoint - S3 endpoint URL (e.g., https://seaweedfs.example.com:8333)
   * @param accessKeyId - S3 access key
   * @param secretAccessKey - S3 secret key
   * @param bucket - Default bucket name
   * @param logger - Logger instance
   */
  constructor(
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
    bucket: string,
    logger: Logger
  ) {
    this.logger = logger;
    this.bucket = bucket;

    const endpointUrl = new URL(endpoint);

    this.client = new S3Client({
      endpoint: `${endpointUrl.protocol}//${endpointUrl.host}`,
      region: "us-east-1",
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
      maxAttempts: 3,
    });

    this.isConfigured = true;

    this.logger.log("🔧 S3Manager initialized");
    this.logger.log(`🔗 Endpoint: ${endpoint}`);
    this.logger.log(`🪣 Bucket: ${bucket}`);
  }

  /**
   * Alternative constructor pattern using SeaweedFSConfig
   * Creates an unconfigured instance - call configure() before use
   */
  static createUnconfigured(logger: Logger): S3Manager {
    // Return instance with dummy values - configure() must be called
    const instance = Object.create(S3Manager.prototype);
    instance.logger = logger;
    instance.bucket = '';
    instance.client = null as unknown as S3Client;
    instance.currentFilePath = '';
    instance.isConfigured = false;
    return instance;
  }

  /**
   * Configure the S3 client with SeaweedFS configuration
   * Matches RcloneManager.configure() interface for easy replacement
   */
  async configure(config: SeaweedFSConfig): Promise<void> {
    this.logger.log("🔧 Configuring S3 client...");

    this.bucket = config.bucket;

    const endpointUrl = new URL(config.endpoint);

    this.logger.log(`🔗 SeaweedFS Endpoint: ${config.endpoint}`);
    this.logger.log(`🪣 Target Bucket: ${config.bucket}`);

    this.client = new S3Client({
      endpoint: `${endpointUrl.protocol}//${endpointUrl.host}`,
      region: "us-east-1",
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
      maxAttempts: 3,
    });

    this.isConfigured = true;

    this.logger.log("✅ S3 client configuration complete");

    // Test connection by listing buckets
    try {
      this.logger.log("🔍 Testing SeaweedFS connection...");
      const buckets = await this.listBuckets();
      this.logger.log(`✅ SeaweedFS connection successful (${buckets.length} buckets found)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.log(`⚠️ SeaweedFS connection test failed: ${errorMessage}`);
      this.logger.log("⚠️ Will proceed and try during actual operations...");
    }

    // Ensure bucket exists
    await this.ensureBucketExists(config.bucket);
  }

  /**
   * Ensure a bucket exists, create it if it doesn't
   */
  private async ensureBucketExists(bucketName: string): Promise<void> {
    this.logger.log(`🪣 Ensuring bucket '${bucketName}' exists...`);

    try {
      // Check if bucket exists by listing and checking
      const buckets = await this.listBuckets();
      const bucketExists = buckets.some(b => b === bucketName);

      if (bucketExists) {
        this.logger.log(`✅ Bucket '${bucketName}' already exists`);
        return;
      }

      // Create bucket
      const createCommand = new CreateBucketCommand({
        Bucket: bucketName
      });

      await this.client.send(createCommand);
      this.logger.log(`✅ Bucket '${bucketName}' created successfully`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.log(`⚠️ Bucket creation error: ${errorMessage}`);
      this.logger.log("⚠️ Will proceed anyway - bucket might already exist");
    }
  }

  /**
   * List all buckets in the S3 account
   * @returns Array of bucket names
   */
  async listBuckets(): Promise<string[]> {
    try {
      this.logger.log("🔍 Listing buckets...");
      const command = new ListBucketsCommand({});
      const response = await this.client.send(command);
      const buckets = response.Buckets?.map((b) => b.Name || "") || [];
      this.logger.log(`✅ Found ${buckets.length} buckets`);
      return buckets;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`❌ Failed to list buckets: ${message}`);
      throw error;
    }
  }

  /**
   * Upload from URL to S3 with automatic multipart upload support
   *
   * @param url - Source URL to download from
   * @param key - S3 object key (path in bucket)
   * @param bucketName - Optional target bucket (defaults to configured bucket)
   * @param maxRetries - Maximum retry attempts (default: 3)
   * @param retryDelayMs - Base delay between retries (default: 5000ms)
   */
  async uploadFromUrl(
    url: string,
    key: string,
    bucketName?: string,
    maxRetries: number = 3,
    retryDelayMs: number = 5000
  ): Promise<void> {
    const targetBucket = bucketName || this.bucket;
    const remotePath = `${targetBucket}/${key}`;

    this.logger.log(`☁️ Starting direct stream from HTTP to S3...`);
    this.logger.log(`📍 Source: ${url}`);
    this.logger.log(`🎯 Destination: ${remotePath}`);
    this.logger.log(`📦 File: ${key}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.logger.log(`🔄 Transfer attempt ${attempt}/${maxRetries}`);
      this.logger.logProgress(`🔄 Starting transfer attempt ${attempt}/${maxRetries}`);

      try {
        // Check if file already exists and delete it for clean upload
        try {
          await this.client.send(new HeadObjectCommand({
            Bucket: targetBucket,
            Key: key
          }));
          this.logger.log("🗑️  Removing existing file...");
          await this.client.send(new DeleteObjectCommand({
            Bucket: targetBucket,
            Key: key
          }));
          this.logger.log("✅ Existing file removed");
        } catch {
          // File doesn't exist, continue
        }

        this.logger.log("🚀 Starting HTTP stream upload...");
        this.logger.logProgress("🚀 Transfer started - streaming from HTTP...");

        // Fetch the file from URL with streaming
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("Response has no body");
        }

        const contentLength = response.headers.get('content-length');
        const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

        if (totalSize > 0) {
          this.logger.log(`📊 File size: ${this.formatBytes(totalSize)}`);
        }

        // Use Upload from @aws-sdk/lib-storage for automatic multipart support
        const upload = new Upload({
          client: this.client,
          params: {
            Bucket: targetBucket,
            Key: key,
            Body: response.body as ReadableStream<Uint8Array>,
            ContentType: response.headers.get('content-type') || 'application/octet-stream',
          },
          queueSize: 4,
          partSize: 5 * 1024 * 1024, // 5MB parts for multipart
          leavePartsOnError: false,
        });

        // Track upload progress
        upload.on("httpUploadProgress", (progress) => {
          const loaded = progress.loaded || 0;
          const total = progress.total || totalSize || 0;
          const percent = total > 0 ? ((loaded / total) * 100).toFixed(2) : "0";
          const loadedStr = this.formatBytes(loaded);
          const totalStr = total > 0 ? this.formatBytes(total) : 'unknown';
          this.logger.logProgress(`📊 Uploaded: ${loadedStr} / ${totalStr} (${percent}%)`);
        });

        await upload.done();

        this.logger.log("✅ Transfer completed successfully!");
        this.logger.logProgress("✅ Transfer completed successfully!");

        // Verify the upload
        this.logger.log("🔍 Verifying uploaded file...");
        const headCommand = new HeadObjectCommand({
          Bucket: targetBucket,
          Key: key,
        });
        const headResponse = await this.client.send(headCommand);
        const verifiedSize = headResponse.ContentLength || 0;
        this.logger.log(`✅ File verified: ${this.formatBytes(verifiedSize)}`);
        this.logger.logProgress(`✅ File verified: ${this.formatBytes(verifiedSize)}`);

        // Show final bucket contents
        this.logger.log("📋 Final bucket contents:");
        await this.logBucketContents(targetBucket);

        return; // Success!

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.log(`❌ Attempt ${attempt} failed: ${message}`);
        this.logger.logProgress(`❌ Attempt ${attempt} failed: ${message}`);

        if (attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
          this.logger.log(`⏳ Waiting ${delay}ms before retry...`);
          this.logger.logProgress(`⏳ Waiting ${delay}ms before retry...`);
          await Bun.sleep(delay);

          // Clean up any partial uploads before retry
          this.logger.log("🗑️ Cleaning up partial uploads...");
          try {
            await this.client.send(new DeleteObjectCommand({
              Bucket: targetBucket,
              Key: key
            }));
          } catch {
            // Ignore cleanup errors
          }
        } else {
          this.logger.log("💥 All retry attempts exhausted");
          this.logger.logProgress("💥 All retry attempts exhausted");
          throw error;
        }
      }
    }
  }

  /**
   * Stream from HTTP URL to S3 - RcloneManager-compatible interface
   *
   * Matches the signature of RcloneManager.streamToS3() for easy replacement
   */
  async streamToS3(
    sourceUrl: string,
    bucketName: string,
    filename: string,
    logPath?: string, // Kept for interface compatibility
    maxRetries: number = 3,
    retryDelayMs: number = 5000
  ): Promise<void> {
    await this.uploadFromUrl(sourceUrl, filename, bucketName, maxRetries, retryDelayMs);
  }

  /**
   * Update HTTP remote configuration
   * Kept for interface compatibility with RcloneManager
   */
  async updateHttpRemote(url: string): Promise<void> {
    this.logger.log(`🔄 Updating HTTP remote for URL: ${url}`);

    try {
      // Parse the URL to get the base URL and file path
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const filePath = urlObj.pathname;

      this.logger.log(`🔧 Base URL: ${baseUrl}`);
      this.logger.log(`🔧 File path: ${filePath}`);

      // Store the file path for potential use
      this.currentFilePath = filePath;

      this.logger.log("✅ HTTP remote configuration updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`❌ Failed to update HTTP remote: ${message}`);
      throw error;
    }
  }

  /**
   * Get the S3 client instance for advanced operations
   */
  getClient(): S3Client {
    return this.client;
  }

  /**
   * Get the configured bucket name
   */
  getBucket(): string {
    return this.bucket;
  }

  /**
   * Check if the manager has been configured
   */
  getConfigured(): boolean {
    return this.isConfigured;
  }

  /**
   * List objects in a bucket for logging purposes
   */
  private async logBucketContents(bucketName: string): Promise<void> {
    try {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: 20
      });
      const response = await this.client.send(command);

      const objects = response.Contents || [];
      if (objects.length === 0) {
        this.logger.log("  (bucket is empty)");
      } else {
        objects.forEach(obj => {
          const size = this.formatBytes(obj.Size || 0);
          this.logger.log(`  - ${obj.Key}: ${size}`);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`  (unable to list bucket contents: ${message})`);
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
