import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const lockPath = path.join(root, '.agents/impeccable.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const skillRoot = lock.skillPath.startsWith('~/')
  ? path.join(homedir(), lock.skillPath.slice(2))
  : path.resolve(root, lock.skillPath);

async function collectFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute, base)));
    } else if (entry.isFile()) {
      files.push(path.relative(base, absolute).split(path.sep).join('/'));
    } else {
      throw new Error(`不支持的 Skill 文件类型：${absolute}`);
    }
  }

  return files;
}

async function payloadHash(directory) {
  const hash = createHash('sha256');
  const files = await collectFiles(directory);

  for (const relative of files) {
    hash.update(relative);
    hash.update('\0');
    hash.update(await readFile(path.join(directory, relative)));
    hash.update('\0');
  }

  return { digest: hash.digest('hex'), count: files.length };
}

function parseSkillVersion(source) {
  const match = source.match(/^version:\s*([^\s]+)\s*$/m);
  if (!match) throw new Error('SKILL.md 缺少 version 字段');
  return match[1];
}

function compareSemver(left, right) {
  const a = left.replace(/^v/, '').split('.').map(Number);
  const b = right.replace(/^v/, '').split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败：${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function runOptional(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

const skillSource = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
const installedVersion = parseSkillVersion(skillSource);
const payload = await payloadHash(skillRoot);
const localErrors = [];

if (installedVersion !== lock.skillVersion) {
  localErrors.push(`版本不一致：锁定 ${lock.skillVersion}，实际 ${installedVersion}`);
}
if (payload.digest !== lock.payloadSha256) {
  localErrors.push(`内容摘要不一致：锁定 ${lock.payloadSha256}，实际 ${payload.digest}`);
}

console.log(`Impeccable Skill ${installedVersion}，${payload.count} 个文件`);
console.log(`来源 ${lock.releaseTag} @ ${lock.sourceCommit}`);
console.log(`内容摘要 ${payload.digest}`);

if (localErrors.length > 0) {
  for (const error of localErrors) console.error(`错误：${error}`);
  process.exitCode = 1;
} else {
  console.log('本地锁定与内容完整性检查通过。');
}

if (process.argv.includes('--remote')) {
  const refs = run('git', ['ls-remote', '--tags', lock.repository, 'refs/tags/skill-v*']);
  const rows = refs.split('\n').map((line) => {
    const [commit, ref] = line.split(/\s+/);
    return { commit, ref };
  });
  const versions = rows
    .map(({ ref }) => ref.match(/refs\/tags\/skill-v(\d+\.\d+\.\d+)(?:\^\{\})?$/)?.[1])
    .filter(Boolean)
    .sort(compareSemver);
  const latestSkill = versions.at(-1);
  const lockedRef = `refs/tags/${lock.releaseTag}`;
  const remoteLockedCommit =
    rows.find(({ ref }) => ref === `${lockedRef}^{}`)?.commit ?? rows.find(({ ref }) => ref === lockedRef)?.commit;
  const latestCli = JSON.parse(run('npm', ['view', 'impeccable', 'version', '--json']));
  const installedCli = runOptional('impeccable', ['--version']);

  console.log(`远端稳定 Skill：${latestSkill ?? '未发现'}`);
  console.log(`锁定标签提交：${remoteLockedCommit ?? '未发现'}`);
  console.log(`本机 CLI：${installedCli ?? '未安装'}；npm 稳定 CLI：${latestCli}`);

  if (remoteLockedCommit !== lock.sourceCommit) {
    console.error(`错误：远端 ${lock.releaseTag} 不再指向锁定提交 ${lock.sourceCommit}`);
    process.exitCode = 1;
  }

  if (latestSkill && compareSemver(latestSkill, lock.skillVersion) > 0) {
    console.log(`发现新的稳定 Skill ${latestSkill}，请按 docs/agents/impeccable.md 审核后更新。`);
  } else {
    console.log('Skill 已是最新稳定版本。');
  }
  if (installedCli && compareSemver(latestCli, installedCli) > 0) {
    console.log(`发现新的稳定 CLI ${latestCli}，CLI 与个人全局 Skill 需要分别审核升级。`);
  } else if (!installedCli) {
    console.log('个人全局 Skill 可独立使用；需要 CLI 命令时再安装稳定版 CLI。');
  }
}
