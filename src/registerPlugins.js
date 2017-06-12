import lightscriptPlugin from "./plugins/lightscript";
import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";

function noncePlugin() {}

export default function registerPlugins(plugins) {
  plugins.lightscript = lightscriptPlugin;
  plugins.estree = estreePlugin;
  plugins.flow = flowPlugin;
  plugins.jsx = jsxPlugin;

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
