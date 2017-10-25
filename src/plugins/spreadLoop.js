import Parser from "../parser";
import { types as tt, TokenType } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__spreadLoopPluginInstalled) return;
  parser.__spreadLoopPluginInstalled = true;

  tt.spreadLoop = new TokenType("...for");

  pp.parseArrayWithSpreadLoops = function(refShorthandDefaultPos) {
    const node = this.startNode();
    this.next();
    this.parseArrayElementsWithSpreadLoops(node, refShorthandDefaultPos);
    return this.finishNode(node, "ArrayExpression");
  };

  // c/p parseExprList
  pp.parseArrayElementsWithSpreadLoops = function (node, refShorthandDefaultPos) {
    const elts = [];
    let first = true, hasSpreadLoop = false;

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

      if (this.match(tt.spreadLoop) && this.state.value === "for") {
        hasSpreadLoop = true;
        elts.push(this.parseSpreadLoop("SpreadElement"));
      } else {
        elts.push(this.parseExprListItem(true, refShorthandDefaultPos));
      }
    }

    node.elements = elts;
    this.toReferencedList(node.elements);
    return hasSpreadLoop;
  };

  pp.parseSpreadLoop = function(spreadElementType) {
    const spreadElement = spreadElementType == null ? null : this.startNode();
    const spreadLoop = this.startNode();
    const loop = this.startNode();
    spreadLoop.loop = this.parseForStatement(loop);
    if (spreadElementType == null) return this.finishNode(spreadLoop, "SpreadLoop");
    spreadElement.argument = this.finishNode(spreadLoop, "SpreadLoop");
    return this.finishNode(spreadElement, spreadElementType);
  };
}
