import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    publicUrl?: string;
}

export interface PresignedUrlResult {
    uploadUrl: string;
    publicUrl: string;
}

/**
 * Extracts R2 configuration from a standard Cloudflare Worker environment object.
 * Expects: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 * Optional: R2_PUBLIC_URL
 */
export function getR2ConfigFromEnv(env: any): R2Config {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
        throw new Error('Missing R2 configuration. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in your environment.');
    }
    return {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucketName: env.R2_BUCKET_NAME,
        publicUrl: env.R2_PUBLIC_URL
    };
}

/**
 * Generates a presigned URL for uploading to Cloudflare R2 (or compatible S3 storage).
 * This function is intended to be used on the server side.
 * 
 * @param config The R2 configuration object
 * @param key The destination file path/key (e.g., "images/photo.jpg")
 * @param contentType The MIME type of the file
 * @param expiresIn Expiration time in seconds (default: 3600)
 */
export async function createR2PresignedUrl(
    config: R2Config,
    key: string,
    contentType: string,
    expiresIn: number = 3600
): Promise<PresignedUrlResult> {
    const S3 = new S3Client({
        region: 'auto',
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });

    const command = new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(S3, command, { expiresIn });
    
    let publicUrl = '';
    if (config.publicUrl) {
        // Ensure no trailing slash on base URL and no leading slash on key
        const baseUrl = config.publicUrl.replace(/\/$/, '');
        const cleanKey = key.replace(/^\//, '');
        publicUrl = `${baseUrl}/${cleanKey}`;
    } else {
        publicUrl = `https://pub-${config.accountId}.r2.dev/${key}`;
    }

    return { uploadUrl, publicUrl };
}

/**
 * Uploads a file to a presigned URL using XMLHttpRequest.
 * This function supports upload progress tracking and is intended for the client side.
 * 
 * @param uploadUrl The presigned URL obtained from the server
 * @param file The browser File object to upload
 * @param onProgress Optional callback for progress updates (0-100)
 */
export function uploadToPresignedUrl(
    uploadUrl: string, 
    file: File, 
    onProgress?: (percent: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type);

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total) * 100;
                    onProgress(percent);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`Upload failed with status: ${xhr.status} ${xhr.statusText}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
    });
}
