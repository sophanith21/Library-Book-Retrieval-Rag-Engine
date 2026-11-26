import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature V4 query-string presigning for S3 GET requests
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html).
 *
 * Hand-rolled instead of pulling in @aws-sdk/s3-request-presigner: it is a
 * pure function of its inputs, needs no network access, and lets us sign with
 * the *public* endpoint the browser will use (S3_PUBLIC_ENDPOINT) while the
 * S3 client itself talks to the internal one (S3_ENDPOINT).
 */
export interface PresignInput {
  /** Scheme + host (+ port) as the browser will reach it, e.g. http://localhost:8333 */
  endpoint: string;
  /** Path below the endpoint, e.g. "/books/covers/x.jpg" (path-style) */
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresInSeconds: number;
  /** Signing time; defaults to now */
  date?: Date;
  /** Extra query parameters that become part of the signature */
  query?: Record<string, string>;
}

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const sha256Hex = (data: string) =>
  createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/** "20130524T000000Z" */
function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function presignGetUrl(input: PresignInput): string {
  const url = new URL(input.endpoint);
  const host = url.host; // includes the port when it is not the default
  const date = input.date ?? new Date();
  const timestamp = amzDate(date);
  const day = timestamp.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;

  const basePath = url.pathname.replace(/\/+$/, '');
  const canonicalUri = (basePath + input.path)
    .split('/')
    .map((segment) => rfc3986(segment))
    .join('/');

  const params: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(input.expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `${url.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
