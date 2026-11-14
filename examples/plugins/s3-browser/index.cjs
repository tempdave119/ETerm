/**
 * S3 浏览器插件样例：不依赖 AWS SDK，手写 SigV4 签名。
 * 插件在主进程运行，面板通过宿主消息桥请求 list / download。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const { join } = require('node:path');

const MAX_DOWNLOAD = 5 * 1024 * 1024;

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function signingKey(secretKey, dateStamp, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request');
}

/** 生成 SigV4 Authorization；query 按 key 排序并做 RFC3986 编码。 */
function signRequest({ method, path, query, host, accessKey, secretKey, region, amzDate, payloadHash }) {
  const dateStamp = amzDate.slice(0, 8);
  const canonicalQuery = Object.keys(query ?? {})
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(String(query[key] ?? ''))}`)
    .join('&');
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmac(signingKey(secretKey, dateStamp, region), stringToSign).toString('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function requireString(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} 不能为空`);
  return text;
}

function normalizeConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const endpoint = new URL(requireString(config.endpoint, 'Endpoint'));
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('Endpoint 必须是 http(s) 地址');
  }
  return {
    endpoint,
    bucket: requireString(config.bucket, 'Bucket'),
    region: typeof config.region === 'string' && config.region.trim() ? config.region.trim() : 'us-east-1',
    accessKey: requireString(config.accessKey, 'Access Key'),
    secretKey: requireString(config.secretKey, 'Secret Key'),
    prefix: typeof config.prefix === 'string' ? config.prefix.trim() : '',
  };
}

/** 路径风格访问：/<bucket>[/<key>]，兼容 mock 与大多数自建对象存储。 */
function objectPath(bucket, key) {
  const base = `/${encodeRfc3986(bucket)}`;
  if (!key) return base;
  return `${base}/${key
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/')}`;
}

async function s3Fetch(config, method, key, query) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const path = objectPath(config.bucket, key);
  const authorization = signRequest({
    method,
    path,
    query,
    host: config.endpoint.host,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    amzDate,
    payloadHash: 'UNSIGNED-PAYLOAD',
  });

  const url = new URL(`${config.endpoint.origin}${path}`);
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);

  const response = await fetch(url, {
    method,
    headers: {
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
      authorization,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`S3 ${response.status} ${detail.slice(0, 200)}`);
  }
  return response;
}

function textOf(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? match[1] : '';
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** ListObjectsV2：只取 Key / Size / LastModified，够面板展示即可。 */
async function listObjects(config) {
  const query = { 'list-type': '2' };
  if (config.prefix) query.prefix = config.prefix;
  const response = await s3Fetch(config, 'GET', '', query);
  const xml = await response.text();
  const objects = [];
  const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
  for (const block of contents) {
    objects.push({
      key: decodeXml(textOf(block, 'Key')),
      size: Number(textOf(block, 'Size') || 0),
      lastModified: textOf(block, 'LastModified'),
    });
  }
  return objects;
}

async function downloadObject(config, key) {
  const response = await s3Fetch(config, 'GET', key, {});
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD) {
    throw new Error(`对象超过 ${Math.round(MAX_DOWNLOAD / 1024 / 1024)} MB，暂不通过面板下载`);
  }
  return {
    name: key.split('/').at(-1) ?? key,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    base64: buffer.toString('base64'),
  };
}

module.exports = {
  // 供单测直接调用；宿主只依赖 activate。
  __test: { signRequest, listObjects, downloadObject, objectPath },
  activate(api) {
    api.registerPanelHandler('browser', async (payload) => {
      const action = payload && typeof payload === 'object' ? payload.action : '';
      const config = normalizeConfig(payload && typeof payload === 'object' ? payload.config : null);
      if (action === 'list') return { objects: await listObjects(config) };
      if (action === 'download') {
        return await downloadObject(config, requireString(payload.key, '对象 Key'));
      }
      throw new Error(`未知动作：${String(action)}`);
    });

    // 自检命令供冒烟使用：读环境变量里的配置，把列表写到 userData。
    api.registerCommand('selftest', async () => {
      const raw = process.env.ETERM_S3_SELFTEST;
      if (!raw) throw new Error('未设置 ETERM_S3_SELFTEST');
      const config = normalizeConfig(JSON.parse(raw));
      const objects = await listObjects(config);
      fs.writeFileSync(
        join(process.env.ETERM_USER_DATA ?? '', 's3-selftest.json'),
        JSON.stringify(objects),
      );
    });
  },
};