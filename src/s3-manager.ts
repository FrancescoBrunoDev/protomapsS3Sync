import { S3Client, ListBucketsCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Logger } from "./logger.js";

export class S3Manager {
  private client: S3Client;
  private bucket: string;
  private logger: Logger;

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
    });

    this.logger.log("🔧 S3Manager initialized");
    this.logger.log(`🔗 Endpoint: ${endpoint}`);
    this.logger.log(`🪣 Bucket: ${bucket}`);
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

  async uploadFromUrl(url: string, key: string): Promise<void> {
    this.logger.log(`☁️ Starting upload from URL to S3...`);
    this.logger.log(`📍 Source: ${url}`);
    this.logger.log(`🎯 Destination: ${this.bucket}/${key}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response has no body");
      }

      this.logger.log("🚀 Starting S3 upload...");

      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: response.body as ReadableStream,
        },
        queueSize: 4,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
      });

      upload.on("httpUploadProgress", (progress) => {
        const loaded = progress.loaded || 0;
        const total = progress.total || 0;
        const percent = total > 0 ? ((loaded / total) * 100).toFixed(2) : "0";
        const loadedMB = (loaded / 1024 / 1024).toFixed(2);
        const totalMB = (total / 1024 / 1024).toFixed(2);
        this.logger.logProgress(`📊 Uploaded: ${loadedMB} MB / ${totalMB} MB (${percent}%)`);
      });

      await upload.done();

      this.logger.log("✅ Upload completed successfully!");

      const headCommand = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const headResponse = await this.client.send(headCommand);
      const sizeMB = ((headResponse.ContentLength || 0) / 1024 / 1024).toFixed(2);
      this.logger.log(`✅ File verified: ${sizeMB} MB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`❌ Upload failed: ${message}`);
      throw error;
    }
  }
}
