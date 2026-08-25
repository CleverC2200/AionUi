const fs = require('fs');

function matches(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

function classifyPrGates(paths) {
  const normalizedPaths = paths.map((entry) => entry.trim().replace(/^\.\//, '')).filter(Boolean);
  if (normalizedPaths.length === 0) {
    return {
      docs_only: false,
      cross_platform_tests: true,
      installer_smoke: true,
      release_scripts: true,
    };
  }

  const docsOnly = normalizedPaths.every((path) =>
    matches(path, [/\.md$/i, /^docs\//, /^\.vscode\//, /^\.github\/ISSUE_TEMPLATE\//])
  );
  const crossPlatformTests = normalizedPaths.some((path) =>
    matches(path, [
      /^package\.json$/,
      /^bun\.lock$/,
      /^packages\/desktop\/electron\.vite\.config\.ts$/,
      /^packages\/desktop\/src\/(index\.ts|preload\/|process\/)/,
      /^packages\/shared-scripts\//,
      /^resources\//,
      /^scripts\//,
      /^tests\/(e2e|integration|unit\/(assets|build-scripts|process|preload))\//,
      /^\.github\/(actions|workflows)\//,
    ])
  );
  const installerSmoke = normalizedPaths.some((path) =>
    matches(path, [
      /^package\.json$/,
      /^bun\.lock$/,
      /^electron-builder.*\.(json|ya?ml)$/,
      /^packages\/desktop\/electron\.vite\.config\.ts$/,
      /^packages\/shared-scripts\//,
      /^resources\//,
      /^scripts\/(build-with-builder|prepare-aioncore|verify-bundled|smoke-installer|build-fast)/,
      /^tests\/(e2e\/.*installer|unit\/(assets|build-scripts))\//,
      /^\.github\/workflows\/(_build-reusable|build-and-release|build-manual|release-distribute)\.yml$/,
    ])
  );
  const releaseScripts = normalizedPaths.some((path) =>
    matches(path, [
      /^scripts\/(create-mock-release-artifacts|prepare-release-assets|verify-release-assets)\.sh$/,
      /^tests\/unit\/releasePackagingConfig\.test\.ts$/,
      /^\.github\/workflows\/(build-and-release|release-distribute)\.yml$/,
    ])
  );
  const allPathsClassified = normalizedPaths.every((path) =>
    matches(path, [
      /\.md$/i,
      /^docs\//,
      /^\.vscode\//,
      /^\.github\/ISSUE_TEMPLATE\//,
      /^package\.json$/,
      /^bun\.lock$/,
      /^packages\/desktop\/(electron\.vite\.config\.ts|src\/)/,
      /^packages\/(shared-scripts|web-cli|web-host)\//,
      /^mobile\//,
      /^public\//,
      /^examples\//,
      /^resources\//,
      /^scripts\//,
      /^tests\/(e2e|integration|unit)\//,
      /^\.github\/(actions|workflows)\//,
      /^electron-builder.*\.(json|ya?ml)$/,
    ])
  );

  if (!allPathsClassified) {
    return {
      docs_only: false,
      cross_platform_tests: true,
      installer_smoke: true,
      release_scripts: true,
    };
  }

  return {
    docs_only: docsOnly,
    cross_platform_tests: !docsOnly && crossPlatformTests,
    installer_smoke: !docsOnly && installerSmoke,
    release_scripts: !docsOnly && releaseScripts,
  };
}

function writeOutputs(result, outputPath) {
  const output = `${Object.entries(result)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  if (outputPath) fs.appendFileSync(outputPath, output);
  process.stdout.write(output);
}

if (require.main === module) {
  const paths = fs.readFileSync(0, 'utf8').split(/\r?\n/);
  writeOutputs(classifyPrGates(paths), process.env.GITHUB_OUTPUT);
}

module.exports = { classifyPrGates };
