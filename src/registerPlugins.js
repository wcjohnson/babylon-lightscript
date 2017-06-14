import lightscriptPlugin from "./plugins/lightscript";
import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";
import safeCallExistentialPlugin from "./plugins/safeCallExistential";
import bangCallPlugin from "./plugins/bangCall";

function noncePlugin() {}

export default function registerPlugins(plugins, metadata) {
  plugins.lightscript = lightscriptPlugin;
  plugins.estree = estreePlugin;
  plugins.flow = flowPlugin;
  plugins.jsx = jsxPlugin;
  plugins.safeCallExpression = safeCallExistentialPlugin;
  plugins.existentialExpression = safeCallExistentialPlugin;

  plugins.bangCall = bangCallPlugin;
  metadata.bangCall = {
    dependencies: ["lightscript"]
  };

  plugins.enforceSubscriptIndentation = noncePlugin;
  metadata.enforceSubscriptIndentation = {
    dependencies: ["lightscript"]
  };

  // Plugins with string tags only
  ([
    "doExpressions",
    "objectRestSpread",
    "decorators",
    "classProperties",
    "exportExtensions",
    "asyncGenerators",
    "functionBind",
    "functionSent",
    "dynamicImport",
    "classConstructorCall",
  ]).forEach((pluginName) => plugins[pluginName] = noncePlugin);
}
