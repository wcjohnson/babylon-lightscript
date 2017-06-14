import lightscriptPlugin from "./plugins/lightscript";
import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";
import safeCallExistentialPlugin from "./plugins/safeCallExistential";
import bangCallPlugin from "./plugins/bangCall";
import significantWhitespacePlugin from "./plugins/significantWhitespace";

function noncePlugin() {}

export default function registerPlugins(plugins, metadata) {
  plugins.estree = estreePlugin;
  plugins.flow = flowPlugin;
  plugins.jsx = jsxPlugin;
  plugins.safeCallExpression = safeCallExistentialPlugin;
  plugins.existentialExpression = safeCallExistentialPlugin;

  plugins.significantWhitespace = significantWhitespacePlugin;

  plugins.lightscript = lightscriptPlugin;
  metadata.lightscript = {
    dependencies: ["significantWhitespace"]
  };

  plugins.bangCall = bangCallPlugin;
  metadata.bangCall = {
    dependencies: ["significantWhitespace"]
  };

  plugins.enforceSubscriptIndentation = noncePlugin;
  metadata.enforceSubscriptIndentation = {
    dependencies: ["significantWhitespace"]
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
    "classConstructorCall"
  ]).forEach((pluginName) => plugins[pluginName] = noncePlugin);
}
