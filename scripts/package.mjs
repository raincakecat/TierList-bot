import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const entries={};
async function collect(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())await collect(path);else entries[relative('.',path).replaceAll('\\','/')]=new Uint8Array(await readFile(path));}}
await collect('dist/src');await collect('sql');await collect('docs');
for(const name of ['package.json','package-lock.json','README.md','config.example.json','.env.example'])entries[name]=new Uint8Array(await readFile(name));
entries['start.bat']=strToU8('@echo off\r\ncd /d "%~dp0"\r\nnpm start\r\n');
entries['start.sh']=strToU8('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec npm start\n');
const forbidden=Object.keys(entries).filter(p=>p==='config.json'||p==='.env'||p.includes('local-policy')||p.startsWith('data/')||p.startsWith('node_modules/'));if(forbidden.length)throw new Error('Unexpected local files in package');
await mkdir('release',{recursive:true});await writeFile('release/crystal-bot-0.1.0.zip',zipSync(entries,{level:6}));console.log(`Packaged ${Object.keys(entries).length} files in release/crystal-bot-0.1.0.zip`);
