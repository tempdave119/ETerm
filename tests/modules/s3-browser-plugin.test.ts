import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

const require = createRequire(import.meta.url);
const plugin = require('../../examples/plugins/s3-browser/index.cjs') as {
  __test: {
    signRequest(input: {
      method: string;
      path: string;
      query: Record<string, string>;
      host: string;
      accessKey: string;
      secretKey: string;
      region: string;
      amzDate: string;
      payloadHash: string;
    }): string;
    objectPath(bucket: string, key?: string): string;
    listObjects(config: unknown): Promise<{ key: string; size: number; lastModified: string }[]>;
    downloadObject(
      config: unknown,
      key: string,
    ): Promise<{ name: string; contentType: string; base64: string }>;
  };
};

async function withS3Server(run: (endpoint: URL) => Promise<void>): Promise<void> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/demo' && url.searchParams.get('list-type') === '2') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(
        '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>' +
          '<Contents><Key>docs/a.txt</Key><Size>9</Size><LastModified>2026-11-14T00:00:00.000Z</LastModified></Contents>' +
          '<Contents><Key>readme.txt</Key><Size>3</Size><LastModified>2026-11-14T00:00:00.000Z</LastModified></Contents>' +
          '</ListBucketResult>',
      );
      return;
    }
    if (url.pathname === '/demo/docs/a.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('s3-hello');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(new URL(`http://127.0.0.1:${port}`));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function configFor(endpoint: URL) {
  return {
    endpoint,
    bucket: 'demo',
    region: 'us-east-1',
    accessKey: 'AK',
    secretKey: 'SK',
    prefix: '',
  };
}

test('s3_sign_request_is_stable_and_scoped', () => {
  const base = {
    method: 'GET',
    path: '/demo',
    query: { 'list-type': '2' },
    host: '127.0.0.1:9000',
    accessKey: 'AK',
    secretKey: 'SK',
    region: 'us-east-1',
    amzDate: '20261114T000000Z',
    payloadHash: 'UNSIGNED-PAYLOAD',
  };

  const authorization = plugin.__test.signRequest(base);
  assert.match(
    authorization,
    /^AWS4-HMAC-SHA256 Credential=AK\/20261114\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(authorization, plugin.__test.signRequest(base));
  assert.notEqual(authorization, plugin.__test.signRequest({ ...base, secretKey: 'SK2' }));
});

test('s3_object_path_encodes_segments', () => {
  assert.equal(plugin.__test.objectPath('demo'), '/demo');
  assert.equal(plugin.__test.objectPath('demo', 'docs/a b.txt'), '/demo/docs/a%20b.txt');
  assert.equal(plugin.__test.objectPath('demo', 'a/b/c.txt'), '/demo/a/b/c.txt');
});

test('s3_list_objects_parses_mock_response', async () => {
  await withS3Server(async (endpoint) => {
    const objects = await plugin.__test.listObjects(configFor(endpoint));

    assert.deepEqual(
      objects.map((object) => object.key),
      ['docs/a.txt', 'readme.txt'],
    );
    assert.equal(objects[0]?.size, 9);
  });
});

test('s3_download_returns_base64', async () => {
  await withS3Server(async (endpoint) => {
    const result = await plugin.__test.downloadObject(configFor(endpoint), 'docs/a.txt');

    assert.equal(result.name, 'a.txt');
    assert.equal(Buffer.from(result.base64, 'base64').toString('utf8'), 's3-hello');
  });
});