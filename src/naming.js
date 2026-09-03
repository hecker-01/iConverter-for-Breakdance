const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function compileRemoval(value, useRegex = false) {
  if (!value) return { expression: null, error: null };
  try {
    return {
      expression: useRegex
        ? new RegExp(value, 'g')
        : new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      error: null,
    };
  } catch (error) {
    return {
      expression: null,
      error: error.message.replace(/^Invalid regular expression:\s*/i, ''),
    };
  }
}

export function splitSvgName(filename) {
  const normalized = String(filename).replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const directory = slash >= 0 ? normalized.slice(0, slash + 1) : '';
  const basename = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return {
    directory,
    stem: basename.replace(/\.svg$/i, ''),
  };
}

export function sanitizeStem(value) {
  let stem = String(value)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();

  if (!stem) stem = 'converted';
  if (RESERVED_WINDOWS_NAMES.test(stem)) stem = `_${stem}`;
  return stem.slice(0, 180);
}

export function createOutputNames(items, options = {}) {
  const { remove = '', useRegex = false, prefix = '', suffix = '' } = options;
  const compiled = compileRemoval(remove, useRegex);
  if (compiled.error) return { names: [], error: compiled.error };

  const counts = new Map();
  const names = items.map((item) => {
    const { directory, stem } = splitSvgName(item.relativeName || item.name);
    const stripped = compiled.expression ? stem.replace(compiled.expression, '') : stem;
    const cleanStem = sanitizeStem(`${prefix}${stripped}${suffix}`);
    const collisionKey = `${directory}${cleanStem}`.toLocaleLowerCase('en-US');
    const count = (counts.get(collisionKey) || 0) + 1;
    counts.set(collisionKey, count);
    const uniqueStem = count === 1 ? cleanStem : `${cleanStem}-${count}`;
    return {
      basename: `${uniqueStem}.svg`,
      relativeName: `${directory}${uniqueStem}.svg`,
    };
  });

  return { names, error: null };
}
