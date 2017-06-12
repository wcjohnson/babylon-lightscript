import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  // Don't install twice
  if (parser.__safeCallExistentialPluginInstalled) return;
  parser.__safeCallExistentialPluginInstalled = true;

  pp.parseSafeCall = function(expr, startPos, startLoc) {
    const node = this.startNodeAt(startPos, startLoc);
    node.callee = expr;
    node.safe = true;

    if (this.hasPlugin("bangCall") && this.isBang()) {
      this.next();
      return this.parseBangCall(node, "CallExpression");
    } else {
      this.expect(tt.parenL);
      node.arguments = this.parseCallExpressionArguments(tt.parenR, false);
      return this.finishNode(node, "CallExpression");
    }
  };

  pp.parseExistential = function(expr, startPos, startLoc) {
    const node = this.startNodeAt(startPos, startLoc);
    node.argument = expr;
    return this.finishNode(node, "ExistentialExpression");
  };

  pp.parseQuestionSubscript = function(lhs, startPos, startLoc, noCalls) {
    const questionPos = this.state.pos;
    const questionLine = this.state.curLine;
    const state = this.state.clone();

    this.eat(tt.question);

    // `?(` = safecall or poorly-formatted ternary
    // TODO: lint rule for ternaries recommending space after ?
    if (
      !noCalls &&
      this.state.pos === (questionPos + 1) &&
      this.hasPlugin("safeCallExpression") &&
      (
        this.match(tt.parenL) ||
        (this.hasPlugin("bangCall") && this.isBang())
      )
    ) {
      try {
        return this.parseSafeCall(lhs, startPos, startLoc);
      } catch (e) {
        this.state = state;
        this.eat(tt.question);
      }
    }

    // If the next token startsExpr, this is a ternary -- unwind recursive descent
    if (this.state.type.startsExpr && this.state.curLine === questionLine) {
      this.state = state;
      return null;
    }

    // Otherwise this is an existential
    if (this.hasPlugin("existentialExpression")) {
      return this.parseExistential(lhs, startPos, startLoc);
    } else {
      this.unexpected(questionPos);
    }
  };

  // Convert an existential to an optional flow parameter.
  // Resolves grammar ambiguity in arrow function arg lists.
  pp.existentialToParameter = function(node) {
    node.argument.optional = true;
    return node.argument;
  };
}
