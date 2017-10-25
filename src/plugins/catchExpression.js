import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__catchExpressionPluginInstalled) return;
  parser.__catchExpressionPluginInstalled = true;

  pp.parseCatchExpression = function(expr) {
    const node = this.startNodeAt(expr.start, expr.loc.start);
    node.expression = expr;
    const catchIndentLevel = this.state.indentLevel;
    const isEnd = () =>
      !this.match(tt._catch) || this.state.indentLevel !== catchIndentLevel || this.match(tt.eof);

    node.cases = [];
    while (!isEnd()) {
      node.cases.push(this.parseCatchCase());
    }

    return this.finishNode(node, "CatchExpression");
  };

  pp.parseCatchCase = function() {
    const node = this.startNode();
    this.eat(tt._catch);
    this.parseCatchCaseTest(node);
    this.parseCatchCaseConsequent(node);
    return this.finishNode(node, "CatchCase");
  };

  pp.parseCatchCaseConsequent = function(node) {
    // disallow return/continue/break, etc. c/p doExpression
    const oldInFunction = this.state.inFunction;
    const oldLabels = this.state.labels;
    this.state.labels = [];
    this.state.inFunction = false;

    node.consequent = this.parseBlock(false);

    this.state.inFunction = oldInFunction;
    this.state.labels = oldLabels;
  };

  pp.parseCatchCaseTest = function(node) {
    // can't be nested so no need to read/restore old value
    this.state.inMatchCaseTest = true;

    this.parseCatchCaseAtoms(node);
    if (this.isContextual("as")) {
      this.parseCatchCaseBinding(node);
    }

    this.state.inMatchCaseTest = false;
  };

  pp.parseCatchCaseAtoms = function(node) {
    const atoms = [];
    this.state.inMatchAtom = true;
    while (true) {
      atoms.push(this.parseExprOps());
      if (!this.eat(tt.comma)) break;
    }
    this.state.inMatchAtom = false;
    node.atoms = atoms;
  };

  pp.parseCatchCaseBinding = function(node) {
    node.binding = this.parseBindingAtom();
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
