// Configuration experiment, not a default change: direct Git Bash with explicit
// one-time wrapper environment preparation, compared with the resume-only build.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { homedir } from 'node:os';
const root = resolve(process.argv[2] || 'C:/projetos/local-validation/performance/pi-pig-tools/smoke');
assert.ok(!existsSync(root), 'Preserve previous evidence; choose a new output directory');
mkdirSync(root, { recursive: true });
const binaries = {
  configured: 'C:/projetos/local-validation/performance/pi-pig-tools/pig-source-patched.exe',
  patched: 'C:/projetos/local-validation/performance/pi-pig-tools/pig-source-patched.exe',
};
const pi = process.env.PI_CLI ?? join(homedir(), '.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
const calls = [
  { name: 'read', args: { path: 'answer.txt' }, expected: 'answer=3' },
  { name: 'edit', args: { path: 'answer.txt', oldText: 'answer=3', newText: 'answer=4' }, expected: 'answer.txt' },
  { name: 'read', args: { path: 'answer.txt' }, expected: 'answer=4' },
  { name: 'bash', args: { command: 'node verify.cjs', timeout: 10 }, expected: 'replay-ok' },
];
let active;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(body.model, 'fixture'); assert.equal(body.stream, true);
    const step = active.requests++;
    assert.ok(step <= calls.length, 'Unexpected extra provider request');
    if (step) {
      const last = body.messages.at(-1);
      assert.equal(last.role, 'tool');
      assert.ok(JSON.stringify(last.content).includes(calls[step - 1].expected), 'Actual tool result mismatch');
    }
    const start = performance.now();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const emit = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ id: 'local-replay', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
    emit({ role: 'assistant' });
    if (step < calls.length) {
      const call = calls[step];
      emit({ tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
      emit({}, 'tool_calls');
    } else { emit({ content: 'health-ok' }); emit({}, 'stop'); }
    res.end('data: [DONE]\n\n');
    active.serverMs += performance.now() - start;
  } catch (error) { active.error = error.stack; res.writeHead(500); res.end('Fixture assertion failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
function memory(pid) {
  return JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid} -ErrorAction Stop; @{rssMiB=$p.WorkingSet64/1MB;peakRssMiB=$p.PeakWorkingSet64/1MB}|ConvertTo-Json -Compress`], { encoding: 'utf8', timeout: 10000 }));
}
async function run(kind, pair) {
  const dir = join(root, `${pair}-${kind}`); mkdirSync(dir);
  const home = join(dir, 'home'); const agent = join(home, 'agent'); mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'synthetic', models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const directShell = 'C:/Program Files/Git/usr/bin/bash.exe';
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [], compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off', telemetry: { enabled: false }, ...(kind === 'configured' ? { shellPath: directShell } : {}) }));
  writeFileSync(join(dir, 'verify.cjs'), "const fs=require('node:fs');if(fs.readFileSync('answer.txt','utf8')!=='answer=4\\n')process.exit(1);console.log('replay-ok');\n");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|API_KEY|SECRET|PASSWORD|^PI_|^PIG_|^OPTCHAT|^NODE_OPTIONS/.test(key)));
  Object.assign(env, { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agent, PIG_HOME: home, PIG_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_TELEMETRY: '0', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost' });
  let setupMs = 0;
  let environmentProof;
  if (kind === 'configured') {
    // Reproduce the installed wrapper's actual environment, not a guessed PATH
    // or a cached value from another home. This probe is setup cost, not free.
    writeFileSync(join(dir, 'shell-env.cjs'), 'process.stdout.write(JSON.stringify(process.env));');
    const setupStart = performance.now();
    const capture = shell => JSON.parse(execFileSync(shell, ['-c', 'node shell-env.cjs'], { cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 10000 }));
    const wrapperEnvironment = capture('C:/Program Files/Git/bin/bash.exe');
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
    for (const key of ['PATH', 'HOME', 'MSYSTEM', 'PLINK_PROTOCOL', 'EXEPATH']) {
      if (wrapperEnvironment[key] !== undefined) env[key] = wrapperEnvironment[key];
    }
    const directEnvironment = capture(directShell);
    const differentKeys = [...new Set([...Object.keys(directEnvironment), ...Object.keys(wrapperEnvironment)])].filter(k => directEnvironment[k] !== wrapperEnvironment[k]);
    assert.deepEqual(differentKeys, [], 'Direct shell must retain the complete observed child environment (key names only)');
    setupMs = performance.now() - setupStart;
    environmentProof = { identicalChildEnvironment: true, keys: Object.keys(wrapperEnvironment).length };
  }
  const args = ['--mode', 'rpc', '--no-session', '--model', 'fixture/fixture', '--thinking', 'off', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--tools', 'read,edit,bash', '--offline'];
  const started = performance.now();
  const child = spawn(kind === 'pi' ? process.execPath : binaries[kind], kind === 'pi' ? [pi, ...args] : args, { cwd: dir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => stderr += b);
  let eventLog = []; let pending = []; let waiters = [];
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let event; try { event = JSON.parse(line); } catch { stderr += '\nInvalid JSON: ' + line; return; }
    const at = performance.now(); eventLog.push({ at, event });
    const index = waiters.findIndex(w => w.test(event));
    if (index >= 0) { const w = waiters.splice(index, 1)[0]; clearTimeout(w.timer); w.resolve({ at, event }); }
    else pending.push({ at, event });
  });
  const wait = test => {
    const index = pending.findIndex(row => test(row.event));
    if (index >= 0) return Promise.resolve(pending.splice(index, 1)[0]);
    return new Promise((resolve, reject) => { const w = { test, resolve, timer: setTimeout(() => { waiters = waiters.filter(x => x !== w); reject(new Error('RPC timeout: ' + stderr.slice(-2000))); }, 20000) }; waiters.push(w); });
  };
  const send = obj => child.stdin.write(JSON.stringify(obj) + '\n');
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  try {
    send({ type: 'get_state', id: 'ready' });
    const ready = await wait(e => e.type === 'response' && e.id === 'ready');
    assert.equal(ready.event.success, true, JSON.stringify(ready.event));
    assert.equal(ready.event.data.model.provider, 'fixture');
    const startupMs = ready.at - started; const idleMemory = memory(child.pid);
    const turns = [];
    for (let turn = 0; turn < 6; turn++) {
      writeFileSync(join(dir, 'answer.txt'), 'answer=3\n');
      active = { requests: 0, serverMs: 0 }; pending = []; eventLog = [];
      const before = performance.now();
      send({ type: 'prompt', id: `turn-${turn}`, message: 'Run the deterministic replay.' });
      await wait(e => e.type === 'agent_end');
      const totalMs = performance.now() - before;
      assert.ok(!active.error, active.error); assert.equal(active.requests, 5);
      const starts = eventLog.filter(x => x.event.type === 'tool_execution_start');
      const ends = eventLog.filter(x => x.event.type === 'tool_execution_end');
      assert.deepEqual(starts.map(x => x.event.toolName), calls.map(x => x.name));
      assert.equal(ends.length, 4); assert.ok(ends.every(x => x.event.isError === false));
      const tools = starts.map((x, i) => ({ name: x.event.toolName, ms: ends[i].at - x.at }));
      const file = readFileSync(join(dir, 'answer.txt'), 'utf8'); assert.equal(file, 'answer=4\n');
      const final = eventLog.filter(x => x.event.type === 'message_end' && x.event.message?.role === 'assistant').at(-1);
      assert.equal(final.event.message.content[0].text, 'health-ok');
      const toolMs = tools.reduce((n, x) => n + x.ms, 0);
      turns.push({ turn, warmup: turn === 0, totalMs, tools, toolMs, nonToolMs: totalMs - toolMs, serverMs: active.serverMs, requests: active.requests, sha256: createHash('sha256').update(file).digest('hex') });
    }
    const finalMemory = memory(child.pid);
    const row = { kind, pair, setupMs, environmentProof, startupMs, idleMemory, finalMemory, turns, stderr };
    writeFileSync(join(dir, 'result.json'), JSON.stringify(row, null, 2));
    child.stdin.end(); const exit = await closed; assert.equal(exit.code, 0, JSON.stringify(exit));
    return row;
  } catch (error) {
    writeFileSync(join(dir, 'failure.json'), JSON.stringify({ error: error.stack, stderr, active, eventLog }, null, 2));
    child.kill(); await closed; throw error;
  } finally { lines.close(); }
}
const rows = [];
try {
  for (let pair = 0; pair < Number(process.argv[3] || 1); pair++) {
    const variants = ['pi', 'patched', 'configured'];
    const order = [...variants.slice(pair % 3), ...variants.slice(0, pair % 3)];
    for (const kind of order) {
      const row = await run(kind, pair); assert.equal(row.stderr, '', 'Unexpected stderr'); rows.push(row);
      writeFileSync(join(root, 'raw.json'), JSON.stringify(rows, null, 2));
      console.log(JSON.stringify({ kind, pair, startupMs: row.startupMs, idleMemory: row.idleMemory, turnsMs: row.turns.map(x => x.totalMs) }));
    }
  }
  const median = xs => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];
  const summary = { protocol: 'same local mock HTTP/SSE; RPC; isolated empty profiles; no extensions/MCP/history/TUI; 1 warmup + 5 turns per process; rotating process order; same resume-only PiG binary in both configurations; configured explicitly selects usr/bin/bash.exe with one-time measured wrapper-environment capture; setupMs is reported separately; event-observed tool time includes RPC delivery; nonTool includes local HTTP/context/serialization; main-process RSS excludes bash children', externalModelRequests: 0 };
  for (const kind of ['pi', 'patched', 'configured']) {
    const selected = rows.filter(x => x.kind === kind); const turns = selected.flatMap(x => x.turns.filter(t => !t.warmup));
    summary[kind] = { setupMs: median(selected.map(x => x.setupMs)), environmentProof: selected.every(x => kind !== 'configured' || x.environmentProof?.identicalChildEnvironment === true), processes: selected.length, measuredTurns: turns.length, startupMs: median(selected.map(x => x.startupMs)), rssMiB: median(selected.map(x => x.finalMemory.rssMiB)), peakRssMiB: median(selected.map(x => x.finalMemory.peakRssMiB)), processFlowMediansMs: selected.map(x => median(x.turns.filter(t => !t.warmup).map(t => t.totalMs))), totalMs: median(turns.map(x => x.totalMs)), toolMs: median(turns.map(x => x.toolMs)), nonToolMs: median(turns.map(x => x.nonToolMs)), tools: calls.map((call, i) => ({ name: call.name, ms: median(turns.map(t => t.tools[i].ms)) })) };
  }
  writeFileSync(join(root, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
