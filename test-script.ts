#!/usr/bin/env bun
import { $ } from "bun";
import { config } from "dotenv";

// Load environment variables
config();

async function testScript() {
    console.log("🧪 Testing script with a small file...");

    // Configure rclone
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

    // Create a test file
    const testContent = `Test file created at ${new Date().toISOString()}`;
    const testFilePath = "/tmp/test-protomaps.txt";
    await Bun.write(testFilePath, testContent);

    console.log("📁 Created test file");

    // Test upload to S3
    try {
        await $`rclone mkdir minio:protomaps`.quiet();
        console.log("📦 Bucket 'protomaps' ready");

        const uploadResult = await $`rclone copy ${testFilePath} minio:protomaps/ --progress`;

        if (uploadResult.exitCode === 0) {
            console.log("✅ Test upload completed successfully!");

            // List files in bucket
            const listResult = await $`rclone ls minio:protomaps/`;
            console.log("📋 Files in bucket:");
            console.log(listResult.stdout.toString());
        } else {
            console.error("❌ Test upload failed");
        }
    } catch (error) {
        console.error("❌ Upload error:", error);
    }
}

// Run test
if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
    await testScript();
}
