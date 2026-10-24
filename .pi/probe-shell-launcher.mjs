// Isolated local shell-launcher measurement; no provider or agent configuration changes.
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]);
assert.ok(!existsSync(root), 'Use fresh evidence directory');
mkdirSync(root,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/TOKEN|API_KEY|SECRET|PASSWORD|^PI_|^PIG_|^OPTCHAT|^NODE_OPTIONS/.test(k)));
Object.assign(env,{HOME:root,USERPROFILE:root});
const shells={launcher:'C:/Program Files/Git/bin/bash.exe',direct:'C:/Program Files/Git/usr/bin/bash.exe'};
writeFileSync(join(root,'verify.cjs'),"const fs=require('node:fs');if(fs.readFileSync('answer.txt','utf8')!=='answer=4\\n')process.exit(1);console.log('replay-ok');\n");
writeFileSync(join(root,'answer.txt'),'answer=4\n');
const samples=[];
for(const command of ['printf replay-ok','node verify.cjs']) {
  for(let i=0;i<22;i++) for(const kind of i%2?['direct','launcher']:['launcher','direct']) {
    const began=performance.now();
    const result=spawnSync(shells[kind],['-c',command],{env,cwd:root,encoding:'utf8',windowsHide:true});
    const ms=performance.now()-began;
    assert.ifError(result.error);assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(result.stdout.trim(),'replay-ok');
    samples.push({command,kind,iteration:i,warmup:i<2,ms});
  }
}
writeFileSync(join(root,'env.cjs'),"process.stdout.write(JSON.stringify(process.env));");
const environments={};
for(const [kind,shell] of Object.entries(shells)) {
  const result=spawnSync(shell,['-c','node env.cjs'],{env,cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0);assert.equal(result.stderr,'');environments[kind]=JSON.parse(result.stdout);
}
const differingEnvironmentKeys=[...new Set([...Object.keys(environments.launcher),...Object.keys(environments.direct)])].filter(k=>environments.launcher[k]!==environments.direct[k]);
// Check whether explicitly preparing the wrapper's PATH gives the actual bash
// the same child environment, rather than silently removing Git's setup.
const preparedEnv={...env};
for(const key of Object.keys(preparedEnv))if(key.toUpperCase()==='PATH')delete preparedEnv[key];
preparedEnv.PATH=environments.launcher.PATH;
const prepared=spawnSync(shells.direct,['-c','node env.cjs'],{env:preparedEnv,cwd:root,encoding:'utf8',windowsHide:true});
assert.equal(prepared.status,0);assert.equal(prepared.stderr,'');
const preparedEnvironment=JSON.parse(prepared.stdout);
const preparedDifferingKeys=[...new Set([...Object.keys(environments.launcher),...Object.keys(preparedEnvironment)])].filter(k=>environments.launcher[k]!==preparedEnvironment[k]);
writeFileSync(join(root,'prepared-path.json'),JSON.stringify({path:environments.launcher.PATH}));
const median=xs=>xs.toSorted((a,b)=>a-b)[Math.floor(xs.length/2)];
const summary={externalRequests:0,differingEnvironmentKeys,preparedDifferingKeys};
for(const command of ['printf replay-ok','node verify.cjs'])summary[command]=Object.fromEntries(Object.keys(shells).map(kind=>[kind,median(samples.filter(s=>s.command===command&&s.kind===kind&&!s.warmup).map(s=>s.ms))]));
writeFileSync(join(root,'samples.json'),JSON.stringify(samples,null,2));
writeFileSync(join(root,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
