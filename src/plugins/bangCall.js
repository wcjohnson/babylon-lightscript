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

  // Assuming the ! has been eaten, get the arg list. Returns true if the call
  // can be further subscripted.
  pp.parseBangCall = function(node, nodeType) {
    node.arguments = [];
    this.addExtra(node, "bang", true);

    // ASI, ignore impossible args
    if (this.isLineBreak() || !this.state.type.startsExpr)
      return this.finishNode(node, nodeType);

    // Space after bang
    if (this.state.lastTokEnd === (this.state.pos - 1)) {
      this.unexpected(null, "Whitespace required between `!` and first argument.");
    }

    while (true) {
      node.arguments.push(this.parseExprListItem(false));
      if (!this.eat(tt.comma)) break;
    }

    node = this.finishNode(node, nodeType);

    // Subscript only on new line.
    if (this.isLineBreak())
      return node;
    else
      return null;
  };
}
