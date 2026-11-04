import {AsyncLocalStorage} from 'node:async_hooks';
import {ConfigFile, type Config} from './config.js';

export const OTHER_MODES=[['sword','Sword'],['axe','Axe'],['smp','SMP'],['pot','Pot'],['mace','Mace'],['uhc','UHC'],['nethpot','Nethpot'],['spear-mace','Spear Mace']] as const;
export function modeKeys(c:Config){return c.gameModes.length?c.gameModes.map(m=>m.key):['crystal'];}
export function modeConfig(c:Config,key:string):Config{
  const mode=c.gameModes.find(m=>m.key===key);if(!mode)return c;
  const result=structuredClone(c);result.activeMode={key:mode.key,name:mode.name};
  result.permissionGroups.verifiedTester=[...mode.testerRoleIds];
  for(const tier of Object.keys(result.tierRoleIds) as (keyof Config['tierRoleIds'])[])result.tierRoleIds[tier]=mode.tierRoleIds[tier]??null;
  for(const r of ['NA','EU','AS'] as const)result.regions[r]={...mode.regions[r],regionRoleId:c.regions[r].regionRoleId};
  result.categories.highTests=mode.highTestsCategoryId;result.testing.normalCooldown=mode.normalCooldown;result.testing.highCooldown=mode.highCooldown;
  result.backups.directory=`${c.backups.directory}/${key}`;
  return result;
}
function saveMode(base:Config,value:Config,key:string):Config{
  if(!base.gameModes.length)return value;
  const result=structuredClone(value);result.gameModes=structuredClone(base.gameModes);const mode=result.gameModes.find(m=>m.key===key);if(!mode)throw Error('Unknown game mode');
  mode.testerRoleIds=[...value.permissionGroups.verifiedTester];mode.tierRoleIds={...value.tierRoleIds};mode.regions=structuredClone(value.regions);mode.highTestsCategoryId=value.categories.highTests;mode.normalCooldown=value.testing.normalCooldown;mode.highCooldown=value.testing.highCooldown;
  delete result.activeMode;
  // The master fields remain the compatible default mode; shared role/channel
  // settings are saved once, while selected-mode resources stay in their entry.
  result.permissionGroups.verifiedTester=base.permissionGroups.verifiedTester;result.tierRoleIds=base.tierRoleIds;
  result.regions=structuredClone(base.regions);for(const r of ['NA','EU','AS'] as const)result.regions[r].regionRoleId=value.regions[r].regionRoleId;
  result.categories.highTests=base.categories.highTests;result.testing.normalCooldown=base.testing.normalCooldown;result.testing.highCooldown=base.testing.highCooldown;result.backups.directory=base.backups.directory;
  return result;
}
export class ModeScope {
  private context=new AsyncLocalStorage<string>();
  private saving:Promise<void>=Promise.resolve();
  readonly file:ConfigFile;
  constructor(readonly master:ConfigFile){
    this.file=new Proxy(master,{get:(target,property)=>{
      if(property==='value')return modeConfig(target.value,this.key);
      if(property==='save')return (value:Config)=>{const key=this.key;const task=this.saving.catch(()=>{}).then(()=>target.save(saveMode(target.value,value,key)));this.saving=task;return task;};
      const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
    },set:(target,property,value)=>{if(property==='value'){target.value=saveMode(target.value,value as Config,this.key);return true;}return Reflect.set(target,property,value);}});
  }
  get keys(){return modeKeys(this.master.value);}
  get key(){return this.context.getStore()??this.keys[0]!;}
  run<T>(key:string,action:()=>T):T{if(!this.keys.includes(key))throw Error('Unknown game mode');return this.context.run(key,action);}
  async each(action:()=>Promise<void>){for(const key of this.keys)await this.run(key,action);}
}
