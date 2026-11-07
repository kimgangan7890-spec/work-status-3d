import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = code => Object.assign(new Error(code), { code });
const AAD = Buffer.from('work-status-auth:v1');
export function parseSecretKey(value) {
  if (!value || !String(value).trim()) return null;
  const text = String(value).trim();
  const key = /^[a-f0-9]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (key.length !== 32 || (!/^[a-f0-9]{64}$/i.test(text) && key.toString('base64') !== text)) throw fail('INVALID_SECRET_KEY');
  return key;
}

// 서버 내부 전용. 세션 키는 호출자가 정하며 브라우저에는 레코드/키를 반환하지 않는다.
export function createEncryptedStore({ file, key }) {
  const secret = key ? Buffer.from(key) : null;
  if (secret && secret.length !== 32) throw fail('INVALID_SECRET_KEY');
  function read() {
    if (!secret) throw fail('CONNECTION_DISABLED');
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 2_000_000) throw fail('CONNECTION_STORAGE_ERROR');
      const envelope = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (envelope.version !== 1) throw fail('CONNECTION_STORAGE_ERROR');
      const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
      if (iv.length !== 12 || tag.length !== 16) throw fail('CONNECTION_STORAGE_ERROR');
      const decipher = crypto.createDecipheriv('aes-256-gcm', secret, iv); decipher.setAAD(AAD); decipher.setAuthTag(tag);
      const result = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('CONNECTION_STORAGE_ERROR');
      return result;
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw fail('CONNECTION_STORAGE_ERROR');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function write(records) {
    if (!secret) throw fail('CONNECTION_DISABLED');
    const plain = JSON.stringify(records);
    if (Buffer.byteLength(plain) > 1_000_000) throw fail('CONNECTION_STORAGE_ERROR');
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const envelope = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, envelope); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, file);
    } catch { throw fail('CONNECTION_STORAGE_ERROR'); }
    finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch { /* 이미 rename됐으면 없음 */ } }
  }
  function checkId(id) { if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw fail('INVALID_CONNECTION_ID'); }
  return Object.freeze({ enabled: !!secret,
    get(id) { checkId(id); const records = read(); return Object.hasOwn(records, id) ? structuredClone(records[id]) : null; },
    set(id, value) { checkId(id); const records = read(); if (!Object.hasOwn(records,id) && Object.keys(records).length >= 128) throw fail('CONNECTION_LIMIT'); records[id] = structuredClone(value); write(records); },
    remove(id) { checkId(id); const records = read(); delete records[id]; write(records); },
    clear() { read(); write({}); }, // 손상/다른 키의 파일을 덮어쓰지 않는다.
  });
}
