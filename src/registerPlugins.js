import lightscriptPlugin from "./plugins/lightscript";
import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";
import safeCallExistentialPlugin from "./plugins/safeCallExistential";
import bangCallPlugin from "./plugins/bangCall";
import significantWhitespacePlugin from "./plugins/significantWhitespace";
import enhancedComprehensionPlugin from "./plugins/enhancedComprehension";
import { matchCoreSyntax, match } from "./plugins/match";

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

  registerPlugin("estree", estreePlugin, {
    private: true // ESTree plugin must be explicitly specified
  });
  registerPlugin("flow", flowPlugin);
  registerPlugin("jsx", jsxPlugin);

  registerPlugin("flippedImports");
  registerPlugin("seqExprRequiresParen");
  registerPlugin("significantWhitespace", significantWhitespacePlugin);

  registerPlugin("safeCallExpression", safeCallExistentialPlugin);
  registerPlugin("existentialExpression", safeCallExistentialPlugin);

  registerPlugin("lightscript", lightscriptPlugin, {
    dependencies: ["significantWhitespace"]
  });

  registerPlugin("bangCall", bangCallPlugin, {
    dependencies: ["significantWhitespace", "seqExprRequiresParen"]
  });

  registerPlugin("enforceSubscriptIndentation", noncePlugin, {
    dependencies: ["significantWhitespace"]
  });

  // TODO: When match syntax is wrapped up, only one plugin named "match"
  // will be exposed.
  registerPlugin("matchCoreSyntax", matchCoreSyntax, {
    private: true
  });

  registerPlugin("match", match, {
    // XXX: dependency on lsc for bitwise operators/ambiguities -- should be
    // possible to factor that out and completely separate match
    dependencies: ["lightscript", "matchCoreSyntax"]
  });

  registerPlugin("enhancedComprehension", enhancedComprehensionPlugin, {
    dependencies: [
      "lightscript", // needed for `parseIf`
      "seqExprRequiresParen"
    ]
  });
}
