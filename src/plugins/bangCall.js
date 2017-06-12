import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  // Don't install twice
  if (parser.__bangCallPluginInstalled) return;
  parser.__bangCallPluginInstalled = true;

  // TODO: consider whether tokens should be changed so bang is a token
  // rather than a subset of unary.
  pp.isBang = function() {
    return this.state.type.prefix && (this.state.value === "!");
  };

  pp.parseBangCall = function(node, callee) {
    node.callee = callee;
    node.arguments = this.parseBangCallArguments();
    this.addExtra(node, "bang", true);
    return this.finishNode(node, "CallExpression");
  };

  pp.parseBangCallArguments = function() {
    const elts = [];

    // ASI
    if (this.isLineBreak()) return elts;

    // Ignore impossible args
    if (!this.state.type.startsExpr) return elts;

    // Space after bang
    if (this.state.lastTokEnd === (this.state.pos - 1)) {
      this.unexpected(null, "Whitespace is required after `!`");
    }

    while (true) {
      elts.push(this.parseExprListItem(false));

      if (!this.eat(tt.comma)) break;
    }

    return elts;
  };
}
