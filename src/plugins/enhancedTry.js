import Parser from "../parser";
import { types as tt } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__tryExpressionPluginInstalled) return;
  parser.__tryExpressionPluginInstalled = true;

  // c/p parseTryStatement
  pp.parseTry = function(node, isExpression) {
    this.next();

    let indentLevel, isBrace = true;
    if (this.hasPlugin("lightscript")) {
      indentLevel = this.state.indentLevel;
      isBrace = this.match(tt.braceL);
      if (!isBrace) this.pushBlockState("try", indentLevel);
    }

    node.handler = null;
    node.guardedHandlers = [];

    this.parseTryBlock(node, isBrace, isExpression);
    // coalescing `try` can't have catch or finally
    if (node.coalesce) {
      if (this.match(tt._catch) || this.match(tt._finally)) {
        this.unexpected(null, "Cannot use `catch` or `finally` with error-coalescing `try`");
      }
    } else {
      this.parseCatchBlock(node, indentLevel, isBrace);
      if (!isExpression) {
        this.parseFinallyBlock(node, indentLevel, isBrace);
      } else {
        if (this.match(tt._finally)) {
          this.unexpected(null, "Finalizers are illegal with `try` expressions." +
          " Use a `try` statement instead.");
        }
      }
    }

    if (!node.coalesce && !node.handler && !node.finalizer) {
      this.raise(node.start, "Missing catch or finally clause");
    }

    if (this.hasPlugin("lightscript") && !isBrace) this.popBlockState();

    return this.finishNode(node, isExpression ? "TryExpression" : "TryStatement");
  };

  pp.parseTryBlock = function(node, isBrace) {
    if (!isBrace && !this.match(tt.colon)) {
      // Allow `try (Expr)` for error coalescence
      node.block = this.parseExpression();
      node.coalesce = true;
    } else {
      node.block = this.parseBlock();
    }
  };

  pp.parseCatchBlock = function(node, tryIndentLevel, isBrace) {
    const shouldParseCatch = this.match(tt._catch) && (
      !this.hasPlugin("lightscript") ||
      tryIndentLevel <= this.state.indentLevel ||
      (isBrace && !this.matchBlockState("try", this.state.indentLevel))
    );

    if (shouldParseCatch) {
      const clause = this.startNode();
      this.next();

      clause.param = null;
      if (!this.match(tt.colon) && !this.match(tt.braceL)) {
        this.parseCatchClauseParam(clause);
      }

      if (this.hasPlugin("lightscript")) {
        this.expectParenFreeBlockStart(clause);
        if (!this.match(tt.colon) && !this.match(tt.braceL)) {
          this.unexpected(null, "Expected a block.");
        }
      }

      clause.body = this.parseBlock();

      node.handler = this.finishNode(clause, "CatchClause");
    }
  };

  pp.parseCatchClauseParam = function(clause) {
    if (this.hasPlugin("lightscript")) {
      if (this.eat(tt.parenL)) {
        this.addExtra(clause, "hasParens", true);
      }
    } else {
      this.expect(tt.parenL);
    }
    clause.param = this.parseBindingAtom();
    this.checkLVal(clause.param, true, Object.create(null), "catch clause");
    if (!this.hasPlugin("lightscript")) {
      this.expect(tt.parenR);
    }
  };

  pp.parseFinallyBlock = function(node, tryIndentLevel, isBrace) {
    if (this.hasPlugin("lightscript")) {
      const shouldParseFinally = this.match(tt._finally) && (
        tryIndentLevel <= this.state.indentLevel ||
        (isBrace && !this.matchBlockState("try", this.state.indentLevel))
      );
      if (shouldParseFinally) {
        this.next();
        if (!this.match(tt.colon) && !this.match(tt.braceL)) {
          this.unexpected(null, "Expected a block.");
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
