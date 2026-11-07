import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { createEncryptedStore, parseSecretKey } from '../src/server/auth/encrypted-store.js';
const dirs=[];afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
const id=n=>crypto.createHash('sha256').update(String(n)).digest('hex');
function setup(key=crypto.randomBytes(32)){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'w3d-auth-'));dirs.push(dir);const file=path.join(dir,'connections.json');return {file,key,store:createEncryptedStore({file,key})};}
it('토큰과 계정 정보는 암호문에만 쓰고 파일 권한은 600이다',()=>{
 const s=setup(),value=['fixture','credential','not-real'].join('-');s.store.set(id(1),{token:value,login:'sample-user',method:'pat'});
 const text=fs.readFileSync(s.file,'utf8');expect(text).not.toContain(value);expect(text).not.toContain('sample-user');expect(fs.statSync(s.file).mode&0o777).toBe(0o600);
 expect(createEncryptedStore({file:s.file,key:s.key}).get(id(1)).token).toBe(value);
});
it('세션 레코드를 분리하고 삭제는 다른 세션을 건드리지 않는다',()=>{const {store}=setup();store.set(id(1),{token:'a'});store.set(id(2),{token:'b'});store.remove(id(1));expect(store.get(id(1))).toBeNull();expect(store.get(id(2))).toEqual({token:'b'});});
it('잘못된 키와 변조는 거절하고 기존 암호문을 덮어쓰지 않는다',()=>{const s=setup();s.store.set(id(1),{token:'a'});const before=fs.readFileSync(s.file,'utf8');expect(()=>createEncryptedStore({file:s.file,key:crypto.randomBytes(32)}).set(id(2),{})).toThrow('CONNECTION_STORAGE_ERROR');expect(fs.readFileSync(s.file,'utf8')).toBe(before);const e=JSON.parse(before);e.tag=crypto.randomBytes(16).toString('base64');fs.writeFileSync(s.file,JSON.stringify(e));expect(()=>s.store.get(id(1))).toThrow('CONNECTION_STORAGE_ERROR');});
it('키가 없으면 저장을 거절하고 파일을 만들지 않는다',()=>{const s=setup(null);expect(s.store.enabled).toBe(false);expect(()=>s.store.set(id(1),{})).toThrow('CONNECTION_DISABLED');expect(fs.existsSync(s.file)).toBe(false);});
it('키 형식을 검사하고 노출할 오류에는 키 원문을 넣지 않는다',()=>{const key=crypto.randomBytes(32);expect(parseSecretKey(key.toString('base64'))).toEqual(key);expect(parseSecretKey(key.toString('hex'))).toEqual(key);expect(parseSecretKey('')).toBeNull();expect(()=>parseSecretKey('invalid')).toThrow('INVALID_SECRET_KEY');});
