import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('refresh stops on a failed snapshot, preserves diagnostics and never fetches downstream', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'scripts'));
  const cli = path.join(dir, 'scripts/analyze-refresh.mjs');
  await copyFile(new URL('../scripts/analyze-refresh.mjs', import.meta.url), cli);
  await writeFile(path.join(dir, 'scripts/build-snapshot.mjs'), "console.error('missing page text: transactions'); process.exit(1);");
  await writeFile(path.join(dir, 'scripts/fetch-gamelogs.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('unexpected-fetch', 'bad');");
  const result = spawnSync(process.execPath, [cli, 'local/raw/2026-10-23-1200'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /snapshot failed/);
  assert.match(await readFile(path.join(dir, 'local/refreshes/2026-10-23-1200/snapshot.txt'), 'utf8'), /missing page text: transactions/);
  await assert.rejects(access(path.join(dir, 'unexpected-fetch')), { code: 'ENOENT' });
  assert.match(result.stderr, /Steps: snapshot failed; game-logs not run; advice not run/);
  const status = JSON.parse(await readFile(path.join(dir, 'local/refreshes/2026-10-23-1200/status.json'), 'utf8'));
  assert.deepEqual(Object.keys(status.stages), ['snapshot', 'game-logs', 'advice']);
  assert.equal(status.failedStep, 'snapshot');
  assert.equal(status.decisionId, null);

  // A rerun keeps the first attempt's diagnostics instead of overwriting them.
  await writeFile(path.join(dir, 'scripts/build-snapshot.mjs'), "console.error('second failure'); process.exit(1);");
  spawnSync(process.execPath, [cli, 'local/raw/2026-10-23-1200'], { cwd: dir, encoding: 'utf8' });
  assert.match(await readFile(path.join(dir, 'local/refreshes/2026-10-23-1200/attempt-1/snapshot.txt'), 'utf8'), /missing page text: transactions/);
  assert.match(await readFile(path.join(dir, 'local/refreshes/2026-10-23-1200/snapshot.txt'), 'utf8'), /second failure/);
});

test('refresh passes the exact snapshot through all steps and prints computed results', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-refresh-success-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const folder of ['scripts', 'data', 'local/advice']) await mkdir(path.join(dir, folder), { recursive: true });
  const cli = path.join(dir, 'scripts/analyze-refresh.mjs');
  await copyFile(new URL('../scripts/analyze-refresh.mjs', import.meta.url), cli);
  await writeFile(path.join(dir, 'data/schedule-2026-27.json'), JSON.stringify({ season: '2026-27' }));
  const stamp = '2026-10-23-1200';
  const advice = { asOf: '2026-10-23T19:00:00Z', decisionId: 'sample-id', action: 'hold' };
  for (const [script, output, data] of [
    ['build-snapshot.mjs'], ['fetch-gamelogs.mjs'],
    ['advise.mjs', `local/advice/${stamp}.json`, advice],
  ]) {
    // analyze-refresh also imports advise.mjs for the shared summary; only the spawned run records a call.
    await writeFile(path.join(dir, 'scripts', script), `import { appendFileSync, writeFileSync } from 'node:fs';
      import { pathToFileURL } from 'node:url';
      export const planSummary = (report) => ['SUMMARY ' + report.action, 'AS-OF ' + report.asOf];
      if (import.meta.url === pathToFileURL(process.argv[1]).href) {
        appendFileSync('calls.jsonl', JSON.stringify({ script: ${JSON.stringify(script)}, args: process.argv.slice(2) }) + '\\n');
        ${output ? `writeFileSync(${JSON.stringify(output)}, ${JSON.stringify(JSON.stringify(data))});` : ''}
        console.log('full detail');
      }`);
  }
  const result = spawnSync(process.execPath, [cli, `local/raw/${stamp}`], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const calls = (await readFile(path.join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map((c) => c.script), ['build-snapshot.mjs', 'fetch-gamelogs.mjs', 'advise.mjs']);
  const snapshot = path.join(dir, 'local/snapshots', `${stamp}.json`);
  assert.deepEqual(calls[1].args, ['--season', '2026-27', '--snapshot', snapshot]);
  assert.deepEqual(calls[2].args, [snapshot]);
  assert.match(result.stdout, /Decision: sample-id\nSUMMARY hold\nAS-OF 2026-10-23T19:00:00Z/);
  assert.doesNotMatch(result.stdout, /full detail/);
  assert.match(await readFile(path.join(dir, `local/refreshes/${stamp}/advice.txt`), 'utf8'), /full detail/);
  const status = JSON.parse(await readFile(path.join(dir, `local/refreshes/${stamp}/status.json`), 'utf8'));
  assert.deepEqual(status.stages, { snapshot: 'ok', 'game-logs': 'ok', advice: 'ok' });
  assert.equal(status.decisionId, 'sample-id');
});
