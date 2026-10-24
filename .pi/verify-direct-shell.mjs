// Explicit configuration experiment; does not modify live settings or defaults.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]);
assert.ok(!existsSync(root),'Choose a fresh evidence directory');
mkdirSync(root,{recursive:true});
const shells={launcher:'C:/Program Files/Git/bin/bash.exe',direct:'C:/Program Files/Git/usr/bin/bash.exe'};
const base=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/TOKEN|API_KEY|SECRET|PASSWORD|^PI_|^PIG_|^OPTCHAT|^NODE_OPTIONS/.test(k)));
writeFileSync(join(root,'env.cjs'),'process.stdout.write(JSON.stringify(process.env));');
writeFileSync(join(root,'argv.cjs'),'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
writeFileSync(join(root,'startup.sh'),'export PIG_SHELL_PROBE=from-startup\n');
const evidence=[];
for(const scenario of ['ordinary','clean-launch','unicode-home','missing-home','empty-path','custom-system','bash-env']) {
  const env={...base,HOME:root,USERPROFILE:root};
  if(scenario==='clean-launch')for(const key of ['EXEPATH','MSYSTEM','PLINK_PROTOCOL'])delete env[key];
  if(scenario==='unicode-home') {
    env.HOME=join(root,'home with spaces ç');mkdirSync(env.HOME);
  }
  if(scenario==='missing-home')delete env.HOME;
  if(scenario==='empty-path') {
    for(const k of Object.keys(env))if(k.toUpperCase()==='PATH')delete env[k];
    env.PATH='';
  }
  if(scenario==='custom-system') {
    env.MSYSTEM='CUSTOM';delete env.PLINK_PROTOCOL;
  }
  if(scenario==='bash-env')env.BASH_ENV=join(root,'startup.sh').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase());
  const execute=(shell,command,childEnv)=>{
    const result=spawnSync(shell,['-c',command],{cwd:root,env:childEnv,encoding:'utf8',windowsHide:true,timeout:10000});
    assert.ifError(result.error);
    assert.equal(result.signal,null);
    return {status:result.status,stdout:result.stdout,stderr:result.stderr};
  };
  // An absolute Node path lets the environment oracle run with PATH empty.
  const node='"'+process.execPath.replaceAll('\\','/')+'"';
  const oracleCommand=node+' env.cjs';
  const oracle=execute(shells.launcher,oracleCommand,env);
  assert.equal(oracle.status,0);assert.equal(oracle.stderr,'');
  const wrapperEnv=JSON.parse(oracle.stdout);
  const prepared={...env};
  for(const k of Object.keys(prepared))if(k.toUpperCase()==='PATH')delete prepared[k];
  for(const k of ['PATH','HOME','MSYSTEM','PLINK_PROTOCOL','EXEPATH'])if(wrapperEnv[k]!==undefined)prepared[k]=wrapperEnv[k];
  const actual=execute(shells.direct,oracleCommand,prepared);
  assert.equal(actual.status,0);assert.equal(actual.stderr,'');
  const actualEnv=JSON.parse(actual.stdout);
  const differentKeys=[...new Set([...Object.keys(actualEnv),...Object.keys(wrapperEnv)])].filter(k=>actualEnv[k]!==wrapperEnv[k]);
  assert.deepEqual(differentKeys,[],'environment mismatch keys: '+scenario);
  const commands=[
    'printf "hello\\n"; printf "warning\\n" >&2; exit 7',
    'printf "%s\\n" "space value" "quoted \\\"text\\\"" "Unicode ç"',
    'printf "%s\\n" "$HOME" "$MSYSTEM" "$PLINK_PROTOCOL" "$PATH" "$BASH" "$PIG_SHELL_PROBE"; pwd -P',
    'printf "a\\nb\\n" | while read -r line; do printf "<%s>" "$line"; done',
    node+' argv.cjs "two words" "quote\\\"value" "back\\\\slash" "Unicode ç"',
    'printf tail; (printf background-tail) & wait',
    'command -v git; command -v sed',
  ];
  for(const command of commands) {
    const expected=execute(shells.launcher,command,env);
    assert.deepEqual(execute(shells.direct,command,prepared),expected,'behavior mismatch: '+scenario+' '+command);
  }
  evidence.push({scenario,identicalChildEnvironment:true,comparedCommands:commands.length});
}
const result={passed:true,externalRequests:0,scenarios:evidence};
writeFileSync(join(root,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
