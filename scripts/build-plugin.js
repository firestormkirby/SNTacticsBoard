#!/usr/bin/env node
/**
 * npm run build:plugin -> build/outputs/snsoccer.snplg
 *
 * Wraps the template's buildPlugin script with one extra step first.
 *
 * buildPlugin reads the list of native packages to register (reactPackages in
 * PluginConfig.json) from Gradle's autolinking output, but only runs Gradle
 * afterwards. On a clean checkout that file does not exist yet, so the first
 * .snplg would ship AsyncStorage and ViewShot compiled in but never
 * registered, and the plugin would fail to start. Generating the autolinking
 * list up front makes the first build correct.
 */
const {spawnSync} = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {cwd, stdio: 'inherit', shell: windows});
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

run(
  // Relative path on Windows: cmd.exe does not always search the working
  // directory (NoDefaultCurrentDirectoryInExePath), so a bare name fails.
  windows ? '.\\gradlew.bat' : './gradlew',
  [':app:generateAutolinkingPackageList'],
  path.join(root, 'android'),
);

if (windows) {
  run(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', 'buildPlugin.ps1'],
    root,
  );
} else {
  run('bash', ['buildPlugin.sh'], root);
}
