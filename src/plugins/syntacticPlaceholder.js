import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__syntacticPlaceholderPluginInstalled) return;
  parser.__syntacticPlaceholderPluginInstalled = true;

  const ph = parser.options.placeholder || "_";
  const quotedPh = (ph + "").replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
  const phRegex = new RegExp("^" + quotedPh + "([0-9]*)$");

  pp.isPlaceholderName = function(name) {
    return phRegex.test(name);
  };

  // c/p parseIdentifier
  pp._parseIdentifierOrPlaceholder = function(liberal) {
    const node = this.startNode();
    if (!liberal) {
      this.checkReservedWord(this.state.value, this.state.start, !!this.state.type.keyword, false);
    }

    let name;
    if (this.match(tt.name)) {
      name = this.state.value;
    } else if (this.state.type.keyword) {
      name = this.state.type.keyword;
    } else {
      this.unexpected();
    }

    const matches = phRegex.exec(name);
    if (matches) {
      if (matches[1]) node.index = parseInt(matches[1]);
      this.next();
      return this.finishNode(node, "PlaceholderExpression");
    }

    node.name = name;

    if (!liberal && node.name === "await" && this.state.inAsync) {
      this.raise(node.start, "invalid use of await inside of an async function");
    }

    node.loc.identifierName = node.name;

    this.next();
    return this.finishNode(node, "Identifier");
  };
}
