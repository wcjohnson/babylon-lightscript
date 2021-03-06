import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__tildeCallPluginInstalled) return;
  parser.__tildeCallPluginInstalled = true;

  // Parse `a~b(...)` or `a~>b(...)` subscript. Returns truthy iff
  // the call is further subscriptable.
  pp.parseTildeCall = function(node, firstArg) {
    this.next();

    // allow `this`, Identifier or MemberExpression, but not calls
    const callee = this.match(tt._this) ? this.parseExprAtom() : this.parseIdentifierOrPlaceholder();
    node.callee = this.parseSubscripts(callee, this.state.start, this.state.startLoc, true);

    // Allow safe tilde calls (a~b?(c))
    if (
      this.hasPlugin("safeCallExpression") &&
      this.state.lastTokEnd === (this.state.pos - 1) &&
      this.eat(tt.question)
    ) {
      node.optional = true;
    }

    // Allow bang tilde calls
    if (this.hasPlugin("bangCall") && this.isAdjacentBang()) {
      const next = this.parseBangCall(node, "CallExpression");
      node.arguments.unshift(firstArg);
      node.tilde = true;
      if (next) {
        return next;
      } else {
        return false;
      }
    } else {
      if (node.optional && this.state.lastTokEnd !== (this.state.pos - 1)) {
        this.unexpected(null, "Whitespace is forbidden after `?` in an optional call.");
      }
      this.expect(tt.parenL);
      node.arguments = this.parseCallExpressionArguments(tt.parenR, false);
      node.arguments.unshift(firstArg);
      node.tilde = true;
      return this.finishNode(node, "CallExpression");
    }
  };
}
