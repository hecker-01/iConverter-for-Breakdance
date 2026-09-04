import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function replaceVersion(file, replacements) {
  const source = await readFile(file, 'utf8');
  let output = source;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(output)) throw new Error(`Could not find version marker in ${file}`);
    output = output.replace(pattern, replacement);
  }
  if (output !== source) await writeFile(file, output);
}

export async function syncVersion(projectDir) {
  const packagePath = resolve(projectDir, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const { version } = packageJson;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }

  await replaceVersion(resolve(projectDir, 'plugin/iconverter/iconverter.php'), [
    [/^( \* Version:\s*).+$/m, `$1${version}`],
    [/(define\( 'ICONVERTER_VERSION', ')[^']+(' \);)/, `$1${version}$2`],
  ]);
  await replaceVersion(resolve(projectDir, 'README.md'), [
    [/(dist\/iconverter-)[^`]+(\.zip)/, `$1${version}$2`],
  ]);

  const lockPath = resolve(projectDir, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  return version;
}

const scriptPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === scriptPath) {
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const version = await syncVersion(projectDir);
  console.log(`Synchronized version ${version}.`);
}
