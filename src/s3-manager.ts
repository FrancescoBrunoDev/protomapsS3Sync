import { S3Client, ListBucketsCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateBucketCommand, UploadPartCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import type { Logger } from "./logger.js";
import type { SeaweedFSConfig } from "./types.js";

export class S3Manager {
  private client: S3Client;
  private bucket: string;
  private logger: Logger;
  private currentFilePath: string = '';
  private isConfigured: boolean = false;

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

  static createUnconfigured(logger: Logger): S3Manager {
    const instance = Object.create(S3Manager.prototype);
    instance.logger = logger;
    instance.bucket = '';
    instance.client = null as unknown as S3Client;
    instance.currentFilePath = '';
    instance.isConfigured = false;
    return instance;
  }

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

    try {
      this.logger.log("🔍 Testing SeaweedFS connection...");
      const buckets = await this.listBuckets();
      this.logger.log(`✅ SeaweedFS connection successful (${buckets.length} buckets found)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.log(`⚠️ SeaweedFS connection test failed: ${errorMessage}`);
      this.logger.log("⚠️ Will proceed and try during actual operations...");
    }

    await this.ensureBucketExists(config.bucket);
  }

  private async ensureBucketExists(bucketName: string): Promise<void> {
    this.logger.log(`🪣 Ensuring bucket '${bucketName}' exists...`);

    try {
      const buckets = await this.listBuckets();
      const bucketExists = buckets.some(b => b === bucketName);

      if (bucketExists) {
        this.logger.log(`✅ Bucket '${bucketName}' already exists`);
        return;
      }

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

  async uploadFromUrl(
    url: string,
    key: string,
    bucketName?: string,
    maxRetries: number = 3,
    retryDelayMs: number = 5000
  ): Promise<void> {
    const targetBucket = bucketName || this.bucket;
    const remotePath = `${targetBucket}/${key}`;

    this.logger.log(`☁️ Starting chunked upload from HTTP to S3...`);
    this.logger.log(`📍 Source: ${url}`);
    this.logger.log(`🎯 Destination: ${remotePath}`);
    this.logger.log(`📦 File: ${key}`);

    const chunkSizeMB = parseInt(process.env.CHUNK_SIZE_MB || '50', 10);
    const chunkSize = chunkSizeMB * 1024 * 1024;
    this.logger.log(`⚙️ Chunk size: ${chunkSizeMB}MB (set CHUNK_SIZE_MB env var to change)`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.logger.log(`🔄 Transfer attempt ${attempt}/${maxRetries}`);
      this.logger.logProgress(`🔄 Starting transfer attempt ${attempt}/${maxRetries}`);

      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (!response.ok) {
          throw new Error(`Failed to fetch HEAD ${url}: ${response.status} ${response.statusText}`);
        }

        const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
        this.logger.log(`📊 Total file size: ${this.formatBytes(totalSize)}`);

        const createMultipart = await this.client.send(new CreateMultipartUploadCommand({
          Bucket: targetBucket,
          Key: key,
          ContentType: 'application/octet-stream',
        }));

        const uploadId = createMultipart.UploadId;
        if (!uploadId) {
          throw new Error("Failed to create multipart upload");
        }

        this.logger.log(`🚀 Multipart upload created: ${uploadId}`);

        const parts: { ETag: string; PartNumber: number }[] = [];
        let partNumber = 1;
        let uploadedBytes = 0;

        const logMemory = () => {
          const usage = process.memoryUsage();
          return `RSS: ${this.formatBytes(usage.rss)}, Heap: ${this.formatBytes(usage.heapUsed)}`;
        };

        while (uploadedBytes < totalSize) {
          const start = uploadedBytes;
          const end = Math.min(uploadedBytes + chunkSize - 1, totalSize - 1);
          const partSize = end - start + 1;

          this.logger.log(`📥 Downloading part ${partNumber}: bytes ${start}-${end} (${this.formatBytes(partSize)})`);

          const partResponse = await fetch(url, {
            headers: { Range: `bytes=${start}-${end}` },
          });

          if (!partResponse.ok && partResponse.status !== 206) {
            throw new Error(`Failed to download part ${partNumber}: ${partResponse.status}`);
          }

          const partData = new Uint8Array(await partResponse.arrayBuffer());

          this.logger.log(`📤 Uploading part ${partNumber} | 🧠 ${logMemory()}`);

          const uploadPartResponse = await this.client.send(new UploadPartCommand({
            Bucket: targetBucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: partData,
          }));

          if (!uploadPartResponse.ETag) {
            throw new Error(`Part ${partNumber} upload failed: no ETag`);
          }

          parts.push({
            ETag: uploadPartResponse.ETag,
            PartNumber: partNumber,
          });

          uploadedBytes += partSize;
          const percent = ((uploadedBytes / totalSize) * 100).toFixed(2);
          this.logger.logProgress(`📊 Uploaded: ${this.formatBytes(uploadedBytes)} / ${this.formatBytes(totalSize)} (${percent}%) | 🧠 ${logMemory()}`);

          partNumber++;
        }

        this.logger.log(`✅ All parts uploaded, completing multipart...`);

        await this.client.send(new CompleteMultipartUploadCommand({
          Bucket: targetBucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }));

        this.logger.log("✅ Transfer completed successfully!");
        this.logger.logProgress("✅ Transfer completed successfully!");

        const headCommand = new HeadObjectCommand({
          Bucket: targetBucket,
          Key: key,
        });
        const headResponse = await this.client.send(headCommand);
        const verifiedSize = headResponse.ContentLength || 0;
        this.logger.log(`✅ File verified: ${this.formatBytes(verifiedSize)}`);
        this.logger.logProgress(`✅ File verified: ${this.formatBytes(verifiedSize)}`);

        await this.logBucketContents(targetBucket);

        return;

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.log(`❌ Attempt ${attempt} failed: ${message}`);
        this.logger.logProgress(`❌ Attempt ${attempt} failed: ${message}`);

        if (attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt - 1);
          this.logger.log(`⏳ Waiting ${delay}ms before retry...`);
          this.logger.logProgress(`⏳ Waiting ${delay}ms before retry...`);
          await Bun.sleep(delay);
        } else {
          this.logger.log("💥 All retry attempts exhausted");
          this.logger.logProgress("💥 All retry attempts exhausted");
          throw error;
        }
      }
    }
  }

  async streamToS3(
    sourceUrl: string,
    bucketName: string,
    filename: string,
    logPath?: string,
    maxRetries: number = 3,
    retryDelayMs: number = 5000
  ): Promise<void> {
    await this.uploadFromUrl(sourceUrl, filename, bucketName, maxRetries, retryDelayMs);
  }

  async updateHttpRemote(url: string): Promise<void> {
    this.logger.log(`🔄 Updating HTTP remote for URL: ${url}`);

    try {
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const filePath = urlObj.pathname;

      this.logger.log(`🔧 Base URL: ${baseUrl}`);
      this.logger.log(`🔧 File path: ${filePath}`);

      this.currentFilePath = filePath;

      this.logger.log("✅ HTTP remote configuration updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`❌ Failed to update HTTP remote: ${message}`);
      throw error;
    }
  }

  getClient(): S3Client {
    return this.client;
  }

  getBucket(): string {
    return this.bucket;
  }

  getConfigured(): boolean {
    return this.isConfigured;
  }

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

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
