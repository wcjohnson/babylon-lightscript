import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__enhancedComprehensionPluginInstalled) return;
  parser.__enhancedComprehensionPluginInstalled = true;

  pp.parseComprehensionArray = function(refShorthandDefaultPos) {
    const node = this.startNode();
    this.next();
    const hasComprehension = this.parseComprehensionArrayElements(node, refShorthandDefaultPos);
    if (hasComprehension) {
      return this.finishNode(node, "ArrayComprehension");
    } else {
      return this.finishNode(node, "ArrayExpression");
    }
  };

  // c/p parseExprList
  pp.parseComprehensionArrayElements = function (node, refShorthandDefaultPos) {
    const elts = [];
    let first = true, hasComprehension = false;

    while (!this.eat(tt.bracketR)) {
      if (first) {
        first = false;
      } else {
        if (this.hasPlugin("lightscript")) {
          this.expectCommaOrLineBreak();
        } else {
          this.expect(tt.comma);
        }
        if (this.eat(tt.bracketR)) break;
      }

      if (this.match(tt._for)) {
        hasComprehension = true;
        elts.push(this.parseLoopComprehension());
      } else if (this.match(tt._case)) {
        hasComprehension = true;
        elts.push(this.parseCaseComprehension());
      } else {
        elts.push(this.parseExprListItem(true, refShorthandDefaultPos));
      }
    }

    node.elements = elts;
    return hasComprehension;
  };

  pp.parseLoopComprehension = function() {
    const node = this.startNode();
    const loop = this.startNode();
    node.loop = this.parseForStatement(loop);
    return this.finishNode(node, "LoopComprehension");
  };

  pp.parseCaseComprehension = function() {
    const node = this.startNode();
    const conditional = this.startNode();
    node.conditional = this.parseIf(conditional, false);
    return this.finishNode(node, "CaseComprehension");
  };

  pp.parseSomeComprehension = function() {
    if (this.match(tt._for)) {
      return this.parseLoopComprehension();
    } else if (this.match(tt._case)) {
      return this.parseCaseComprehension();
    } else {
      this.unexpected(null, "Unexpected token, expected `for` or `case`");
    }
  };
}
