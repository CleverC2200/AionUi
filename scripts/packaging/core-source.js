// Recover the original run/job; never substitute another commit or a latest release.
const { execFileSync } = require('node:child_process');
const PLATFORMS = new Set(['macos-arm64', 'macos-x64', 'windows-x64', 'windows-arm64']);

function inspectCoreSource({ run, jobs, artifacts, repository, sha, platform }) {
  if (!PLATFORMS.has(platform) || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error('Expected repository, exact Core SHA and desktop platform');
  if (
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.head_sha !== sha ||
    run.path !== '.github/workflows/build-manual.yml' ||
    run.event !== 'workflow_dispatch'
  )
    throw new Error('Core source mismatch; recovery cannot change the trusted source');
  if (run.status !== 'completed')
    throw new Error('Core run is still active; reconcile instead of starting another build');
  const candidates = jobs.filter(
    (job) =>
      job.name === `Build ${platform}` &&
      job.run_attempt === run.run_attempt &&
      job.conclusion === 'success' &&
      job.steps?.some((step) => step.name === 'Build release binary' && step.conclusion === 'success')
  );
  if (candidates.length !== 1) throw new Error('Successful Core platform job missing or ambiguous');
  const selected = artifacts.filter((artifact) => artifact.name === `aioncore-manual-${platform}`);
  if (selected.length > 1) throw new Error('Core artifact identity is ambiguous');
  const artifact = selected[0];
  if (artifact && (artifact.workflow_run?.id !== run.id || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')))
    throw new Error('Core artifact source mismatch');
  const state = !artifact
    ? 'missing'
    : artifact.expired === true
      ? 'expired'
      : artifact.expired === false
        ? 'available'
        : 'unknown';
  if (state === 'unknown') throw new Error('Core artifact expiry state is unavailable');
  return {
    state,
    repository,
    sha,
    platform,
    run: run.id,
    attempt: run.run_attempt,
    artifact: artifact ? { id: artifact.id, digest: artifact.digest, expiresAt: artifact.expires_at } : null,
    recoveryArguments: ['run', 'rerun', String(run.id), '--repo', repository, '--job', String(candidates[0].id)],
    interpretation:
      'Availability is metadata only. The normal bundling entry must still verify downloaded content before reuse.',
  };
}

function main() {
  const [mode, repository, runId, sha, platform] = process.argv.slice(2);
  if (
    !['inspect', 'recover'].includes(mode) ||
    !/^[1-9][0-9]*$/.test(runId || '') ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository || '')
  )
    throw new Error('Expected inspect|recover <repository> <run-id> <exact-core-sha> <platform>');
  const api = (endpoint) => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', timeout: 30000 }));
  const endpoint = `repos/${repository}/actions/runs/${runId}`;
  const run = api(endpoint);
  const jobs = api(`${endpoint}/attempts/${run.run_attempt}/jobs?per_page=100`).jobs;
  const artifacts = api(`${endpoint}/artifacts?per_page=100`).artifacts;
  const report = inspectCoreSource({ run, jobs, artifacts, repository, sha, platform });
  if (mode === 'recover' && report.state !== 'available') {
    const current = api(endpoint);
    if (current.run_attempt !== run.run_attempt || current.status !== 'completed')
      throw new Error('Core run changed during inspection; reconcile before recovery');
    try {
      execFileSync('gh', report.recoveryArguments, { stdio: 'inherit', timeout: 30000 });
    } catch {
      throw new Error('Recovery outcome is unconfirmed; inspect the original run before retrying');
    }
    report.state = 'recovery-requested';
  }
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();
module.exports = { inspectCoreSource };
