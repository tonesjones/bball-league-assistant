import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readDecision, newestDecision, DECISIONS_DIR } from '../src/sources/decisions.mjs';
import { decisionInputs } from '../src/sources/bakeoff-records.mjs';
import { buildBrief } from '../src/engine/brief.mjs';

const PROMPT_FILE = fileURLToPath(new URL('../docs/chatgpt-brief.md', import.meta.url));

export function readPrompt(doc) {
  const prompt = doc.split('<!-- PROMPT START -->')[1]?.split('<!-- PROMPT END -->')[0]?.trim();
  const version = /^Brief prompt version: (\d+)$/m.exec(doc)?.[1];
  if (!prompt || !version) throw new Error('docs/chatgpt-brief.md needs prompt markers and a "Brief prompt version:" line');
  return { prompt, version: Number(version) };
}

async function main(args) {
  // --fa and --state are accepted for compatibility and ignored: the context-check brief uses neither.
  let id;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fa') {
      const value = args[++i];
      if (!/^\d+$/.test(value ?? '')) throw new Error('--fa must be a nonnegative integer');
    } else if (args[i] === '--state') {
      if (!args[++i]) throw new Error('--state needs a path to the vault state note');
    } else if (args[i].startsWith('-') || id) throw new Error(`unexpected argument: ${args[i]}`);
    else id = args[i];
  }
  const record = id ? await readDecision(id) : await newestDecision();
  if (!record) throw new Error(`no decisions in ${DECISIONS_DIR}; run npm run advise first`);
  const { snapshot } = await decisionInputs(record);
  const { prompt, version } = readPrompt(await readFile(PROMPT_FILE, 'utf8'));
  const brief = buildBrief({ record, snapshot, prompt, promptVersion: version });
  const file = path.join('local/briefs', `${record.id}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, brief, { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`${file} already exists; delete it to write a new brief`);
    throw err;
  }
  console.log(`Brief: ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
