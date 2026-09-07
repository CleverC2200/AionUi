const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Core recovery preserves the exact successful platform source and distinguishes expiry from mismatch', () => {
  const { inspectCoreSource } = require('../../../scripts/packaging/core-source');
  const sha = 'a'.repeat(40);
  const sample = {
    repository: 'owner/core',
    sha,
    platform: 'windows-x64',
    run: {
      id: 12,
      run_attempt: 1,
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      event: 'workflow_dispatch',
      path: '.github/workflows/build-manual.yml',
      repository: { full_name: 'owner/core' },
      head_repository: { full_name: 'owner/core' },
    },
    jobs: [
      {
        id: 42,
        name: 'Build windows-x64',
        run_attempt: 1,
        conclusion: 'success',
        steps: [{ name: 'Build release binary', conclusion: 'success' }],
      },
    ],
    artifacts: [
      {
        name: 'aioncore-manual-windows-x64',
        id: 20,
        expired: true,
        workflow_run: { id: 12 },
        digest: 'sha256:' + 'b'.repeat(64),
      },
    ],
  };
  const expired = inspectCoreSource(sample);
  assert.equal(expired.state, 'expired');
  assert.deepEqual(expired.recoveryArguments, ['run', 'rerun', '12', '--repo', 'owner/core', '--job', '42']);
  sample.artifacts[0].expired = false;
  assert.equal(inspectCoreSource(sample).state, 'available');
  sample.run.head_sha = 'c'.repeat(40);
  assert.throws(() => inspectCoreSource(sample), /source mismatch/);
});

test('compression comparison holds packaged input fixed and reports each installer size', (t) => {
  const { compareCompression } = require('../../../scripts/packaging/compression-profile');
  const root = fixture(t);
  const app = path.join(root, 'win-unpacked');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'GEAUi.exe'), 'fixed app');
  const calls = [];
  const result = compareCompression({
    prepackaged: app,
    destination: path.join(root, 'comparison'),
    command: 'builder --win --x64 --publish=never',
    execute: (command, options) => {
      calls.push({ command, level: options.env.ELECTRON_BUILDER_COMPRESSION_LEVEL });
      const output = command.match(/--config.directories.output="([^"]+)"/)[1];
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(
        path.join(output, 'GEAUi-test-win-x64.exe'),
        options.env.ELECTRON_BUILDER_COMPRESSION_LEVEL === '7' ? 'larger' : 'small'
      );
    },
  });
  assert.deepEqual(
    result.samples.map((sample) => [sample.level, sample.installerBytes]),
    [
      [7, 6],
      [9, 5],
    ]
  );
  assert.equal(
    calls.every((call) => call.command.includes(`--prepackaged "${app}"`)),
    true
  );
  assert.equal(result.inputUnchanged, true);
  assert.equal(result.recommendation, 'measure-before-changing-default');
});

test('builder artifact events record installer assembly separately from the overall build', (t) => {
  const record = require('../../../scripts/packaging/builder-events');
  const root = fixture(t);
  const previous = process.env.BUILD_STAGE_REPORT;
  process.env.BUILD_STAGE_REPORT = path.join(root, 'events.jsonl');
  try {
    record({ file: path.join(root, 'GEAUi.exe'), targetPresentableName: 'nsis' });
    record({ file: path.join(root, 'GEAUi.exe'), target: { name: 'nsis' } });
    const result = JSON.parse(fs.readFileSync(process.env.BUILD_STAGE_REPORT, 'utf8'));
    assert.equal(result.stage, 'installer-nsis-including-signing');
    assert.equal(result.status, 'ok');
    assert.ok(result.elapsedMs >= 0);
  } finally {
    if (previous === undefined) delete process.env.BUILD_STAGE_REPORT;
    else process.env.BUILD_STAGE_REPORT = previous;
  }
});

test('cloud report separates installer size from installed content and preserves failed stages', (t) => {
  const { buildReport } = require('../../../scripts/packaging/cloud-report');
  const root = fixture(t);
  const out = path.join(root, 'out');
  fs.mkdirSync(path.join(out, 'win-unpacked/resources'), { recursive: true });
  fs.writeFileSync(path.join(out, 'GEAUi-1.0.0-win-x64.exe'), 'installer');
  fs.writeFileSync(path.join(out, 'win-unpacked/GEAUi.exe'), 'application');
  const header = Buffer.from(JSON.stringify({ files: { 'index.js': { size: 3, offset: '0' } } }));
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(header.length, 12);
  fs.writeFileSync(
    path.join(out, 'win-unpacked/resources/app.asar'),
    Buffer.concat([prefix, header, Buffer.from('app')])
  );
  const stages = path.join(root, 'stages.jsonl');
  fs.writeFileSync(stages, JSON.stringify({ stage: 'compile', status: 'failed', elapsedMs: 20 }) + '\n');
  const report = buildReport({ root, platform: 'windows-x64', stageFile: stages });
  assert.equal(report.installers[0].bytes, 9);
  assert.equal(report.stages[0].status, 'failed');
  assert.ok(report.installedLogicalBytes > report.installers[0].bytes);
  assert.equal(report.inventory.packedLogicalBytes, 3);
  assert.deepEqual(report.inventory.largestFiles, [{ path: 'index.js', bytes: 3, unpacked: false }]);
  assert.deepEqual(report.inventory.developmentCandidates, []);
  assert.equal(report.runtimeAcceptance, 'not-run');
  assert.equal(JSON.stringify(report).includes(root), false);
});
