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
  return options;
};
