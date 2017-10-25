import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__tryExpressionPluginInstalled) return;
  parser.__tryExpressionPluginInstalled = true;

  // c/p parseTryStatement
  pp.parseTry = function(node, isExpression) {
    this.next();

    let indentLevel, isColon;
    if (this.hasPlugin("lightscript")) {
      indentLevel = this.state.indentLevel;
      isColon = this.match(tt.colon);
      if (isColon) this.pushBlockState("try", indentLevel);
    }

    node.handler = null;
    node.guardedHandlers = [];

    this.parseTryBlock(node, isColon);
    this.parseCatchBlock(node, indentLevel, isColon);
    if (!isExpression) {
      this.parseFinallyBlock(node, indentLevel, isColon);
    } else {
      if (this.match(tt._finally)) {
        this.unexpected(null, "Finalizers are illegal with `try` expressions." +
        " Use a `try` statement instead.");
      }
    }

    if (!node.handler && !node.finalizer) {
      this.raise(node.start, "Missing catch or finally clause");
    }

    if (this.hasPlugin("lightscript") && isColon) this.popBlockState();

    return this.finishNode(node, isExpression ? "TryExpression" : "TryStatement");
  };

  pp.parseTryBlock = function(node, isColon) {
    if (!isColon && !this.match(tt.braceL)) {
      // Allow try expr
      node.block = this.parseExpression();
    } else {
      node.block = this.parseBlock();
    }
  };

  pp.parseCatchBlock = function(node, tryIndentLevel, isColon) {
    const shouldParseCatch = this.match(tt._catch) && (
      !this.hasPlugin("lightscript") ||
      tryIndentLevel === this.state.indentLevel ||
      (!isColon && !this.matchBlockState("try", this.state.indentLevel))
    );

    if (shouldParseCatch) {
      const clause = this.startNode();
      this.next();

      if (this.hasPlugin("lightscript")) {
        if (this.eat(tt.parenL)) {
          this.addExtra(clause, "hasParens", true);
        }
      } else {
        this.expect(tt.parenL);
      }
      clause.param = this.parseBindingAtom();
      this.checkLVal(clause.param, true, Object.create(null), "catch clause");
      if (this.hasPlugin("lightscript")) {
        this.expectParenFreeBlockStart(clause);
        if (!this.match(tt.colon) && !this.match(tt.braceL)) {
          this.unexpected(null, "Expected a block.");
        }
      } else {
        this.expect(tt.parenR);
      }

      // Detect block vs cases
      const next2 = this.tokenLookahead(2);
      if (next2[0] === tt.bitwiseOR || next2[2] === tt.bitwiseOR) {
        this.parseMatchCases(clause, true, true);
      } else {
        clause.body = this.parseBlock();
      }

      node.handler = this.finishNode(clause, "CatchClause");
    }
  };

  pp.parseFinallyBlock = function(node, tryIndentLevel, isColon) {
    if (this.hasPlugin("lightscript")) {
      const shouldParseFinally = this.match(tt._finally) && (
        tryIndentLevel === this.state.indentLevel ||
        (!isColon && !this.matchBlockState("try", this.state.indentLevel))
      );
      if (shouldParseFinally) {
        this.next();
        if (isColon) {
          this.check(tt.colon);
        } else {
          this.check(tt.braceL);
        }
        node.finalizer = this.parseBlock();
      } else {
        node.finalizer = null;
      }
    } else {
      node.finalizer = this.eat(tt._finally) ? this.parseBlock() : null;
    }
  };
}
