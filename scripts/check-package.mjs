import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';

const entries=unzipSync(await readFile('full-package/full-package.zip')),root=await mkdtemp(join(tmpdir(),'crystal-package-'));
try{
  for(const [path,data]of Object.entries(entries)){
    if(!path.startsWith('full-package/')||path.split('/').includes('..')||/\/(?:local-policy\.json|config\.json|\.env)$/.test(path)||/\/(?:node_modules|data)\//.test(path))throw Error('Unexpected packaged local file');
    const destination=resolve(root,path);if(!destination.startsWith(resolve(root)+sep))throw Error('Unsafe archive path');await mkdir(dirname(destination),{recursive:true});await writeFile(destination,data);
    if(/gh[opusr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(strFromU8(data)))throw Error('Credential material found');
  }
  const manifest=strFromU8(entries['full-package/MANIFEST.sha256']);
  for(const line of manifest.trim().split('\n')){const [hash,path]=line.split('  ');if(!entries[`full-package/${path}`]||createHash('sha256').update(entries[`full-package/${path}`]).digest('hex')!==hash)throw Error('Manifest mismatch');}
  if(manifest.trim().split('\n').length!==Object.keys(entries).length-1)throw Error('Incomplete manifest');
  const cwd=join(root,'full-package'),env={...process.env};delete env.DISCORD_TOKEN;delete env.BOT_CONFIG;
  const install=process.platform==='win32'?spawnSync('cmd.exe',['/d','/s','/c','npm ci --omit=dev --ignore-scripts'],{cwd,env,stdio:'inherit',timeout:120_000}):spawnSync('npm',['ci','--omit=dev','--ignore-scripts'],{cwd,env,stdio:'inherit',timeout:120_000});if(install.status!==0)throw Error('Clean installation failed');
  const c=JSON.parse(await readFile(join(cwd,'config.example.json'),'utf8'));c.community.guildId='100000000000000001';c.database.backend='sqlite';for(const k of Object.keys(c.modules))c.modules[k]=false;c.permissionGroups.owner=['100000000000000002'];c.permissionGroups.botAdmin=['100000000000000003'];for(const k of ['staffActionLog','operationalLog','botReview'])c.channels[k]='100000000000000004';
  await writeFile(join(cwd,'config.json'),JSON.stringify(c));
  const validate=spawnSync(process.execPath,['dist/src/main.js','validate'],{cwd,env,encoding:'utf8',timeout:30_000});if(validate.status!==0)throw Error('Packaged configuration validation failed');
  const start=spawnSync(process.execPath,['dist/src/main.js'],{cwd,env,encoding:'utf8',timeout:30_000});if(start.status!==1||!start.stderr.includes('Set DISCORD_TOKEN'))throw Error('Missing-token startup did not fail safely');
  console.log(`Verified ${Object.keys(entries).length} files, manifest, runtime installation, configuration and safe startup.`);
}finally{const checked=resolve(root);if(!checked.startsWith(resolve(tmpdir())+sep)||!checked.includes('crystal-package-'))throw Error('Unsafe cleanup path');await rm(checked,{recursive:true,force:true});}
