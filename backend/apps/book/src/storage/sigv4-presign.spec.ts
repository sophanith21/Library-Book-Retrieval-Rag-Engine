import { presignGetUrl, rfc3986 } from './sigv4-presign';

describe('presignGetUrl', () => {
  // Worked example from the AWS docs: "Authenticating Requests: Using Query
  // Parameters (AWS Signature Version 4)".
  it('matches the AWS documentation test vector', () => {
    const url = presignGetUrl({
      endpoint: 'https://examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      expiresInSeconds: 86400,
      date: new Date('2013-05-24T00:00:00Z'),
    });

    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('keeps a non-default port in the host and encodes path segments', () => {
    const url = presignGetUrl({
      endpoint: 'http://localhost:8333',
      path: '/books/covers/a b.jpg',
      accessKeyId: 'devaccess',
      secretAccessKey: 'devsecret',
      region: 'us-east-1',
      expiresInSeconds: 60,
      date: new Date('2026-01-01T00:00:00Z'),
    });
    expect(
      url.startsWith('http://localhost:8333/books/covers/a%20b.jpg?'),
    ).toBe(true);
  });

  it('signs extra query parameters in sorted order', () => {
    const url = presignGetUrl({
      endpoint: 'http://localhost:8333',
      path: '/books/epubs/x.epub',
      accessKeyId: 'devaccess',
      secretAccessKey: 'devsecret',
      region: 'us-east-1',
      expiresInSeconds: 60,
      date: new Date('2026-01-01T00:00:00Z'),
      query: {
        'response-content-disposition': 'attachment; filename="x.epub"',
      },
    });
    const query = new URL(url).searchParams;
    expect(query.get('response-content-disposition')).toBe(
      'attachment; filename="x.epub"',
    );
    const keys = [...query.keys()].filter((k) => k !== 'X-Amz-Signature');
    expect(keys).toEqual([...keys].sort());
  });
});

describe('rfc3986', () => {
  it('escapes characters encodeURIComponent leaves alone', () => {
    expect(rfc3986("it's (a)*!")).toBe('it%27s%20%28a%29%2A%21');
  });
});
