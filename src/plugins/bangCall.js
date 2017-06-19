import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__bangCallPluginInstalled) return;
  parser.__bangCallPluginInstalled = true;

  pp.isBang = function() {
    return this.state.type.prefix && (this.state.value === "!");
  };

  // Parse `!` followed by an arg list. Returns truthy if further subscripting
  // is legal.
  pp.parseBangCall = function(node, nodeType) {
    node.arguments = [];
    this.addExtra(node, "bang", true);
    const bangIndentLevel = this.state.indentLevel, bangLine = this.state.curLine;
    let argIndentLevel = null;

    this.next();

    // ASI, ignore impossible args
    if (
      (this.isLineBreak() && this.state.indentLevel <= bangIndentLevel) || !this.state.type.startsExpr
    ) {
      return this.finishNode(node, nodeType);
    }

    if (this.state.lastTokEnd === this.state.start) {
      this.unexpected(null, "Whitespace required between `!` and first argument.");
    }

    // Read args
    let first = true;
    const oldBangIndentLevel = this.state.bangIndentLevel;
    this.state.bangIndentLevel = bangIndentLevel;

    while (true) {
      // First argument on a different line from the `!` establishes indent level
      if (this.state.curLine !== bangLine && argIndentLevel === null) {
        argIndentLevel = this.state.indentLevel;
      }

      // Comma-separated arg and first arg skip ASI/whitespace checks
      if (first || this.eat(tt.comma)) {
        node.arguments.push(this.parseExprListItem(false));
        first = false;
      } else {
        // ASI: unwind if not at proper indent level
        if (this.isLineBreak()) {
          if (
            this.state.indentLevel <= bangIndentLevel ||
            (argIndentLevel !== null && this.state.indentLevel !== argIndentLevel)
          ) {
            break;
          }
        }

        node.arguments.push(this.parseExprListItem(false));
      }

      if (this.isLineBreak()) {
        if (this.match(tt.comma)) {
          this.unexpected(null, "Comma must be on the same line as the preceding argument when using `!`");
        }

        if (!this.state.type.startsExpr) break;
      } else {
        if (!this.match(tt.comma)) break;
      }
    }

    this.state.bangIndentLevel = oldBangIndentLevel;

    node = this.finishNode(node, nodeType);

    // Subscript only on new line.
    if (this.isLineBreak())
      return node;
    else
      return null;
  };

  // When subscripting, a newline always breaks up bang args.
  pp.shouldUnwindBangSubscript = function() {
    return this.isLineBreak() && (this.state.indentLevel <= this.state.bangIndentLevel);
  };
}
