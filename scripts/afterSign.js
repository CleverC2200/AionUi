const { execFileSync, spawnSync } = require('child_process');

function parseMacCodeSignature(output) {
  const authority = output.match(/^Authority=(.+)$/m)?.[1]?.trim() || null;
  const rawSignature = output.match(/^Signature=(.+)$/m)?.[1]?.trim();
  const rawTeamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim();
  const teamIdentifier = rawTeamIdentifier && rawTeamIdentifier !== 'not set' ? rawTeamIdentifier : null;
  const signature = rawSignature === 'adhoc' ? 'adhoc' : 'signed';
  const certificateSigned = signature !== 'adhoc' && authority !== null;
  return {
    authority,
    certificateSigned,
    signature,
    stable: certificateSigned && teamIdentifier !== null,
    teamIdentifier,
  };
}

function inspectMacCodeSignature(appPath) {
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    encoding: 'utf8',
  });
  if (verify.status !== 0) return null;

  const details = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  if (details.status !== 0) return null;
  return parseMacCodeSignature(`${details.stdout || ''}\n${details.stderr || ''}`);
}

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = `${appOutDir}/${appName}.app`;
  const requireStableSignature = process.env.AIONUI_REQUIRE_STABLE_MAC_SIGNATURE === 'true';
  const signature = inspectMacCodeSignature(appPath);

  if (signature?.certificateSigned && !signature.stable) {
    if (requireStableSignature) {
      throw new Error('macOS distributable requires a stable Developer ID signature; found a local certificate');
    }
    console.warn(`App ${appName} is signed by local certificate ${signature.authority}; do not distribute this build`);
    return;
  }

  if (!signature?.stable) {
    if (requireStableSignature) {
      throw new Error(
        `macOS distributable requires a stable Developer ID signature; found ${signature?.signature || 'no valid signature'}`
      );
    }
    if (signature?.signature === 'adhoc') {
      console.warn(`App ${appName} has an ad-hoc signature; this build is for local testing only`);
      return;
    }

    console.warn(`App ${appName} is not code signed, applying an ad-hoc signature for local testing...`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    console.warn(`Ad-hoc signature applied to ${appName}; do not distribute this build`);
    return;
  }

  console.log(`App ${appName} is signed by Apple Developer Team ${signature.teamIdentifier}`);

  // Skip notarization if credentials are not provided
  if (!process.env.appleId || !process.env.appleIdPassword) {
    console.log('Skipping notarization - missing Apple ID credentials');
    return;
  }

  // Lazy-load notarize because @electron/notarize is ESM-only
  const { notarize } = await import('@electron/notarize');

  console.log(`Starting notarization for ${appName} (${appBundleId})...`);

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath: appPath,
      appleId: process.env.appleId,
      appleIdPassword: process.env.appleIdPassword,
      teamId: process.env.teamId,
    });
    console.log('Notarization completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};

exports.parseMacCodeSignature = parseMacCodeSignature;
