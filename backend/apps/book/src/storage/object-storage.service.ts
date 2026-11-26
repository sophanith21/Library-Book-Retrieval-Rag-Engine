import { Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { presignGetUrl } from './sigv4-presign';

/** Presigned URLs are signed against the start of this window so they stay
 * byte-identical (and browser-cacheable) for a while instead of changing on
 * every request. */
const SIGNING_WINDOW_SECONDS = 60 * 60;
const URL_LIFETIME_SECONDS = 2 * SIGNING_WINDOW_SECONDS;

/**
 * SeaweedFS (S3-compatible) access for the book service.
 *
 *   S3_ENDPOINT         where this service reaches storage (http://seaweedfs:8333 in compose)
 *   S3_PUBLIC_ENDPOINT  where browsers reach it (http://localhost:8333); used for presigning
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  readonly bucket = process.env.S3_BUCKET ?? 'books';
  private readonly region = process.env.S3_REGION ?? 'us-east-1';
  private readonly endpoint = (
    process.env.S3_ENDPOINT ?? 'http://localhost:8333'
  ).replace(/\/+$/, '');
  private readonly publicEndpoint = (
    process.env.S3_PUBLIC_ENDPOINT ?? this.endpoint
  ).replace(/\/+$/, '');
  private readonly accessKeyId = process.env.S3_ACCESS_KEY ?? 'devaccess';
  private readonly secretAccessKey = process.env.S3_SECRET_KEY ?? 'devsecret';
  private bucketReady: Promise<void> | undefined;

  private readonly client = new S3Client({
    endpoint: this.endpoint,
    region: this.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
    },
  });

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    return res.Body.transformToByteArray();
  }

  /** Best effort: a missing object is not an error. */
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(
        `Could not delete ${key}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  presignedUrl(
    key: string,
    options: { downloadAs?: string } = {},
  ): { url: string; expiresIn: number } {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = nowSeconds - (nowSeconds % SIGNING_WINDOW_SECONDS);
    const query: Record<string, string> = {};
    if (options.downloadAs) {
      const safe = options.downloadAs.replace(/["\\\r\n]/g, '');
      query['response-content-disposition'] = `attachment; filename="${safe}"`;
    }
    const url = presignGetUrl({
      endpoint: this.publicEndpoint,
      path: `/${this.bucket}/${key}`,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      expiresInSeconds: URL_LIFETIME_SECONDS,
      date: new Date(windowStart * 1000),
      query,
    });
    return {
      url,
      expiresIn: windowStart + URL_LIFETIME_SECONDS - nowSeconds,
    };
  }

  /**
   * Map a stored cover/file reference to a storage key in our bucket, or
   * null when it points somewhere else. Accepts a bare key ("covers/x.jpg")
   * and the absolute URLs bootstrap.py stores
   * ("http://localhost:8333/books/covers/x.jpg").
   */
  keyFor(reference: string | null | undefined): string | null {
    if (!reference) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(reference)) {
      return reference.replace(/^\/+/, '');
    }
    let url: URL;
    try {
      url = new URL(reference);
    } catch {
      return null;
    }
    const ours = [this.endpoint, this.publicEndpoint].some((e) => {
      try {
        return new URL(e).host === url.host;
      } catch {
        return false;
      }
    });
    const prefix = `/${this.bucket}/`;
    if (!ours || !url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
  }

  /** A URL the browser can load for a stored cover/file reference. */
  browserUrl(reference: string | null | undefined): string | null {
    if (!reference) return null;
    const key = this.keyFor(reference);
    return key ? this.presignedUrl(key).url : reference;
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created bucket ${this.bucket}`);
      }
    })().catch((err) => {
      this.bucketReady = undefined; // retry on the next upload
      throw err;
    });
    return this.bucketReady;
  }
}
