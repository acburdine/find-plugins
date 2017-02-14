'use strict';
const fs = require('fs');
const path = require('path');
const resolve = require('resolve');
const readPkg = require('read-pkg');
const readPkgUp = require('read-pkg-up');
const DAG = require('dag-map').default;

function findPlugins(options) {
  options = options || {};
  // The directory to scan for plugins
  let dir = options.dir || process.cwd();
  // The path to the package.json that lists dependencies to check for plugins
  let pkgPath = options.pkg || (options.dir && path.join(options.dir, 'package.json')) || 'package.json';
  let pkg;
  try {
    pkg = readPkg.sync(pkgPath);
  } catch(e) {}
  // An array of additional paths to check as plugins
  let includes = options.include || [];
  // If supplied, a package will be considered a plugin if `keyword` is present in it's
  // package.json "keywords" array
  let keyword = options.keyword;
  // If sort: true is supplied, this determines what property of the plugin's package.json to
  // check for the sort configuration (it should be an object with "before" and "after" properties
  // which are arrays of other plugins names). If no configName is given, default to the pkg name.
  // If no pkg is given, or it failed to load, this will error out early.
  if (!pkg && !options.configName && options.sort) {
    throw new Error('You passed sort: true to findPlugins, but did not provide a valid package.json path or configName');
  }

  let pluginCandidateDirectories = [];

  // The filter function that determines whether a package is a plugin. If options.filter
  // is supplied, go with that. Otherwise, check for options.keyword match.
  function isPlugin(plugin) {
    if (options.filter) {
      return options.filter(plugin);
    }
    if (!plugin.pkg.keywords) {
      return false;
    }
    if (!keyword) {
      keyword = plugin.pkg.name;
    }
    return plugin.pkg.keywords.indexOf(keyword) > -1;
  }

  // scanAllDirs indicates that we should ignore the package.json contents and
  // simply look at the contents of the node_modules directory
  if (options.scanAllDirs) {
    pluginCandidateDirectories = fs.readdirSync(dir);
    // Handle scoped packages
    let scoped = pluginCandidateDirectories.filter((name) => name.charAt(0) === '@')
    pluginCandidateDirectories = pluginCandidateDirectories.filter((name) => name.charAt(0) !== '@');
    scoped.forEach((scope) => {
      fs.readdirSync(path.join(dir, scope))
        .forEach((scopedPackageName) => {
          pluginCandidateDirectories.push(path.join(scope, scopedPackageName));
        });
    });
    // Normalize the paths
    pluginCandidateDirectories = pluginCandidateDirectories
      .filter((name) => name !== '.bin')
      .map((name) => path.join(dir, name))
      .filter((dir) => fs.statSync(dir).isDirectory());
  // Otherwise, use the consuming package.json dependencies as the list of plugin candidates
  } else {
    let dependencies = [];
    if (!options.excludeDependencies) {
      dependencies = dependencies.concat(Object.keys(pkg.dependencies || {}));
    }
    if (options.includeDev) {
      dependencies = dependencies.concat(Object.keys(pkg.devDependencies || {}));
    }
    if (options.includePeer) {
      dependencies = dependencies.concat(Object.keys(pkg.peerDependencies || {}));
    }
    if (options.includeBundle) {
      dependencies = dependencies.concat(Object.keys(pkg.bundleDependencies || pkg.bundledDependencies || {}));
    }
    if (options.includeOptional) {
      dependencies = dependencies.concat(Object.keys(pkg.optionalDependencies || {}));
    }
    pluginCandidateDirectories = dependencies.map((dep) => resolve.sync(dep, { basedir: dir }));
  }

  // Include an manually specified packages in the list of plugin candidates
  pluginCandidateDirectories = pluginCandidateDirectories.concat(includes);


  let plugins = pluginCandidateDirectories.map((dir) => {
    return {
      dir: dir,
      pkg: readPkgUp.sync({ cwd: dir }).pkg
    };
  }).filter(isPlugin);

  if (options.sort) {
    let graph = new DAG();
    plugins.forEach((plugin) => {
      let pluginConfig = plugin.pkg[options.configName || pkg.name] || {};
      graph.add(plugin.pkg.name, plugin, pluginConfig.before, pluginConfig.after);
    });
    plugins = [];
    graph.topsort((key, value) => {
      plugins.push(value);
    });
  }

  return plugins;
}

findPlugins.default = findPlugins;

module.exports = findPlugins;
