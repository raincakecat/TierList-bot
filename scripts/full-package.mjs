import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';

const entries={};
async function collect(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())await collect(path);else entries[relative('.',path).replaceAll('\\','/')]=new Uint8Array(await readFile(path));}}
for(const directory of ['dist/src','src','test','sql','docs','scripts','.github'])await collect(directory);
for(const name of ['package.json','package-lock.json','tsconfig.json','.gitignore','README.md','config.example.json','.env.example'])entries[name]=new Uint8Array(await readFile(name));
entries['Full-Setup-Guide.pdf']=entries['docs/Full-Setup-Guide.pdf'];
delete entries['docs/Full-Setup-Guide.pdf'];
entries['start.bat']=strToU8('@echo off\r\ncd /d "%~dp0"\r\nnpm.cmd start\r\n');
entries['start.sh']=strToU8('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec npm start\n');
entries['START-HERE.txt']=strToU8('Open Full-Setup-Guide.pdf. Install Node.js 24.17.0 or newer. Open a terminal in this folder and run npm ci --omit=dev. Copy config.example.json to config.json and .env.example to .env, then configure your own server/token/database. Run npm start. Open /setup wizard inside Discord, review the private draft and confirm. /health is available to Bot Admin/Owner. No credentials or database are included. Live rehearsal is still required.\n');
const forbidden=Object.keys(entries).filter(p=>p==='config.json'||p==='.env'||p.includes('local-policy')||p.startsWith('data/')||p.startsWith('node_modules/')||p.includes('__pycache__'));
if(forbidden.length)throw new Error('Unexpected local files in package');
const manifest=Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)).map(([name,data])=>`${createHash('sha256').update(data).digest('hex')}  ${name}`).join('\n')+'\n';
entries['MANIFEST.sha256']=strToU8(manifest);
const rooted=Object.fromEntries(Object.entries(entries).map(([name,data])=>[`full-package/${name}`,data]));
await mkdir('full-package',{recursive:true});
const zipped=zipSync(rooted,{level:6});
await writeFile('full-package/full-package.zip',zipped);
if(process.argv[2]){const downloads=resolve(process.argv[2]);await mkdir(downloads,{recursive:true});await writeFile(join(downloads,'full-package.zip'),zipped);await writeFile(join(downloads,'Full-Setup-Guide.pdf'),entries['Full-Setup-Guide.pdf']);}
console.log(`Full package: ${Object.keys(entries).length} files, ${zipped.length} bytes.`);
