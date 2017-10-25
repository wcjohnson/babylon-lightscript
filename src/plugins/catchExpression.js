import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

// Catch-expr syntax
// NoMatchCatchExpression = Expr `\n`? `catch` Identifier `:` Block
// MatchCatchExpression = Expr `\n`? `catch` Identifier `:` [`\n` MatchCase]...

export default function(parser) {
  if (parser.__catchExpressionPluginInstalled) return;
  parser.__catchExpressionPluginInstalled = true;

  pp.parseCatchExpression = function(expr) {
    const node = this.startNodeAt(expr.start, expr.loc.start);
    node.expression = expr;
    this.eat(tt._catch);
    node.binding = this.parseIdentifier();
    // Detect block vs cases
    const next2 = this.tokenLookahead(2);
    if (next2[0] === tt.bitwiseOR || next2[2] === tt.bitwiseOR) {
      return this.parseCatchAndMatchExpression(node);
    } else {
      return this.parseCatchNoMatchExpression(node);
    }
  };

  pp.parseCatchNoMatchExpression = function(node) {
    node.body = this.parseBlock(false);
    return this.finishNode(node, "CatchExpression");
  };

  pp.parseCatchAndMatchExpression = function(node) {
    this.parseMatchCases(node, true, true);
    return this.finishNode(node, "CatchExpression");
  };

  pp.isIndentedCatch = function() {
    return this.match(tt._catch)
      && this.isLineBreak()
      && this.state.indentLevel > this.indentLevelAt(this.state.lastTokStart);
  };

  pp.parseMaybeCatchAssignment = function(assignExpr) {
    if (!this.isIndentedCatch()) return assignExpr;
    assignExpr.right = this.parseCatchExpression(assignExpr.right);
    return this.finishNode(assignExpr, assignExpr.type);
  };

  pp.parseMaybeCatchExpression = function(expr) {
    if (!this.isIndentedCatch()) return expr;
    return this.parseCatchExpression(expr);
  };
}
