// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// The app is a nested package in a plain (non-workspace) repo: watch the repo
// root so `shared/` edits trigger a reload, and add app/node_modules to the
// resolver search list so files outside projectRoot still find their deps.
// (nodeModulesPaths is additive — Metro still walks node_modules up from the
// importing file; this just guarantees app/node_modules is always reachable.)
config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

// `@shared/*` -> `<repo>/shared/*`, mirroring the tsconfig path alias.
// (Today the only shared module is type-only and erases at build time; this
// keeps the alias honest the moment anything runtime-valued moves there.)
const ALIAS = "@shared/";
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith(ALIAS)) {
    return resolve(context, path.join(repoRoot, "shared", moduleName.slice(ALIAS.length)), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
