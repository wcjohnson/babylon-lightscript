import Parser, { plugins, pluginMetadata } from "./parser";
import "./parser/util";
import "./parser/statement";
import "./parser/lval";
import "./parser/expression";
import "./parser/node";
import "./parser/location";
import "./parser/comments";

import { types as tokTypes } from "./tokenizer/types";
import "./tokenizer";
import "./tokenizer/context";

import registerPlugins from "./registerPlugins";

registerPlugins(plugins, pluginMetadata);

export function parse(input, options) {
  return new Parser(options, input).parse();
}

export function parseExpression(input, options) {
  const parser = new Parser(options, input);
  if (parser.options.strictMode) {
    parser.state.strict = true;
  }
  return parser.getExpression();
}

export function getAvailablePlugins() {
  const result = [];
  for (const pluginKey of Object.keys(plugins)) {
    if (!(pluginMetadata[pluginKey] && pluginMetadata[pluginKey].private)) {
      result.push(pluginKey);
    }
  }
  return result;
}

export function getPluginMetadata() {
  return pluginMetadata;
}

export { tokTypes };
