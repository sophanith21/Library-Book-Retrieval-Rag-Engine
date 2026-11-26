const fs = require('fs');
const path = require('path');

/**
 * Resolve the `@app/*` library aliases from tsconfig.json `paths`.
 *
 * tsconfig.json no longer sets `baseUrl` (deprecated in TypeScript 6, removed
 * in 7), and Nest's built-in TsconfigPathsPlugin only resolves `paths` when
 * `baseUrl` is set, so webpack gets explicit aliases instead. tsconfig.json
 * stays the single source of truth.
 */
function tsconfigAliases() {
  const tsconfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf8'),
  );
  const aliases = {};
  for (const [key, targets] of Object.entries(
    tsconfig.compilerOptions.paths ?? {},
  )) {
    // "@app/contracts" also covers "@app/contracts/foo" in webpack.
    if (key.endsWith('/*')) continue;
    aliases[key] = path.resolve(__dirname, targets[0]);
  }
  return aliases;
}

/**
 * Prisma's generated client imports sibling files with a `.js` suffix
 * (`./internal/class.js`) while the files on disk are `.ts`. Node's
 * nodenext resolution accepts that; webpack does not, unless told to.
 */
module.exports = (options) => {
  options.resolve ??= {};
  options.resolve.extensionAlias = {
    ...options.resolve.extensionAlias,
    '.js': ['.ts', '.js'],
  };
  options.resolve.alias = {
    ...options.resolve.alias,
    ...tsconfigAliases(),
  };
  return options;
};
