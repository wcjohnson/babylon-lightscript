import lightscriptPlugin from "./plugins/lightscript";
import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";
import safeCallExistentialPlugin from "./plugins/safeCallExistential";
import bangCallPlugin from "./plugins/bangCall";
import significantWhitespacePlugin from "./plugins/significantWhitespace";

function noncePlugin() {}

export default function registerPlugins(plugins, metadata) {
  function registerPlugin(name, plugin, meta) {
    if (!plugin) plugin = noncePlugin;
    plugins[name] = plugin;
    metadata[name] = meta;
  }

  registerPlugin("doExpressions");
  registerPlugin("objectRestSpread");
  registerPlugin("decorators");
  registerPlugin("classProperties");
  registerPlugin("exportExtensions");
  registerPlugin("asyncGenerators");
  registerPlugin("functionBind");
  registerPlugin("functionSent");
  registerPlugin("dynamicImport");
  registerPlugin("classConstructorCall");

  registerPlugin("estree", estreePlugin);
  registerPlugin("flow", flowPlugin);
  registerPlugin("jsx", jsxPlugin);

  registerPlugin("significantWhitespace", significantWhitespacePlugin);

  registerPlugin("safeCallExpression", safeCallExistentialPlugin);
  registerPlugin("existentialExpression", safeCallExistentialPlugin);

  registerPlugin("lightscript", lightscriptPlugin, {
    dependencies: ["significantWhitespace"]
  });

  registerPlugin("bangCall", bangCallPlugin, {
    dependencies: ["significantWhitespace"]
  });

  registerPlugin("enforceSubscriptIndentation", noncePlugin, {
    dependencies: ["significantWhitespace"]
  });
}
