import lightscriptPlugin from "./plugins/lightscript";
import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";
import tildeCallPlugin from "./plugins/tildeCall";
import safeCallExistentialPlugin from "./plugins/safeCallExistential";
import bangCallPlugin from "./plugins/bangCall";
import significantWhitespacePlugin from "./plugins/significantWhitespace";
import splatComprehensionPlugin from "./plugins/splatComprehension";
import syntacticPlaceholderPlugin from "./plugins/syntacticPlaceholder";
import pipeCallPlugin from "./plugins/pipeCall";
import { matchCoreSyntax, match } from "./plugins/match";

function noncePlugin() {}

export default function registerPlugins(plugins, metadata) {
  metadata._reverseDeps = {};

  function registerPlugin(name, plugin, meta) {
    if (!plugin) plugin = noncePlugin;
    plugins[name] = plugin;
    metadata[name] = meta;
    if (meta && meta.dependencies) {
      meta.dependencies.forEach( (dep) => {
        if (!metadata._reverseDeps[dep]) metadata._reverseDeps[dep] = [];
        metadata._reverseDeps[dep].push(name);
      });
    }
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

  registerPlugin("tildeCallExpression", tildeCallPlugin);
  registerPlugin("safeCallExpression", safeCallExistentialPlugin);
  registerPlugin("existentialExpression", safeCallExistentialPlugin);

  registerPlugin("lightscript", lightscriptPlugin, {
    dependencies: ["significantWhitespace", "tildeCallExpression"]
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

  registerPlugin("splatComprehension", splatComprehensionPlugin, {
    dependencies: [
      "lightscript", // needed for `parseIf`
      "seqExprRequiresParen"
    ]
  });

  // Parse identifiers beginning with `_` or another user-chosen symbol
  // as PlaceholderExpressions.
  registerPlugin("syntacticPlaceholder", syntacticPlaceholderPlugin);

  // |> infix operator for piped function calls
  registerPlugin("pipeCall", pipeCallPlugin);

  registerPlugin("whiteblockOnly", noncePlugin, {
    dependencies: ["lightscript"]
  });

  registerPlugin("whiteblockPreferred", noncePlugin, {
    dependencies: ["lightscript"]
  });
}
