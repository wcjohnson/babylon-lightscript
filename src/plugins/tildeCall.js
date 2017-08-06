import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__tildeCallPluginInstalled) return;
  parser.__tildeCallPluginInstalled = true;

  // Parse `a~b(...)` or `a~>b(...)` subscript. Returns truthy iff
  // the call is further subscriptable.
  pp.parseTildeCall = function(node, left) {
    this.next();
    node.left = left;

    // allow `this`, Identifier or MemberExpression, but not calls
    const right = this.match(tt._this) ? this.parseExprAtom() : this.parseIdentifier();
    node.right = this.parseSubscripts(right, this.state.start, this.state.startLoc, true);

    // Allow safe tilde calls (a~b?(c))
    if (this.hasPlugin("safeCallExpression") && this.eat(tt.question)) {
      node.safe = true;
    }

    // Allow bang tilde calls
    if (this.hasPlugin("bangCall") && this.isAdjacentBang()) {
      const next = this.parseBangCall(node, "TildeCallExpression");
      if (next) return next; else return false;
    } else {
      this.expect(tt.parenL);
      node.arguments = this.parseCallExpressionArguments(tt.parenR, false);
      return this.finishNode(node, "TildeCallExpression");
    }
  };
}
