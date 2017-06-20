import Parser from "../parser";
import { types as tt, KeywordTokenType, keywords } from "../tokenizer/types";
const pp = Parser.prototype;

// Adds keywords + statement/expression parsing hooks
export function matchCoreSyntax(parser) {
  parser.extend("isKeyword", function (inner) {
    return function (name) {
      if (name === "match") return true;
      return inner.call(this, name);
    };
  });

  tt._match = keywords.match = new KeywordTokenType(
    "match",
    { beforeExpr: true, startsExpr: true }
  );
}

// Pattern-matching syntax
// MatchStatement = `match` Expr `:` `\n`MatchCase [`\n`MatchCase]...
// MatchCase = `|` ` ` MatchTest | MatchElse
// MatchTest = [`if` Expr [`when`]] [MatchAtom, MatchAtom, ...] [`with`|`as` MatchBinding] [`if` Expr]: Block
// MatchElse = | `else` [`as` MatchBinding]: Block
// MatchBinding = ArrayPattern|ObjectPattern
// MatchAtom = ExprOps
// (Most non-logical operations and strange expr types are illegal in MatchAtoms)
export function match(parser) {
  if (parser.__matchPluginInstalled) {
    throw new Error("cannot install multiple `match` plugins");
  }
  parser.__matchPluginInstalled = true;

  pp.parseMatchExpression = function (node) {
    return this.parseMatch(node, true);
  };

  pp.parseMatchStatement = function (node) {
    return this.parseMatch(node, false);
  };

  pp.parseMatch = function (node, isExpression) {
    if (this.state.inMatchCaseTest) this.unexpected(null, "`match` is illegal in a match case test");
    this.expect(tt._match);

    node.discriminant = this.parseParenExpression();

    const isColon = this.match(tt.colon);
    let isEnd;
    if (isColon) {
      const indentLevel = this.state.indentLevel;
      this.next();
      isEnd = () => this.state.indentLevel <= indentLevel || this.match(tt.eof);
    } else {
      this.expect(tt.braceL);
      isEnd = () => this.eat(tt.braceR);
    }

    node.cases = [];
    const caseIndentLevel = this.state.indentLevel;
    let hasUsedElse = false;
    while (!isEnd()) {
      if (hasUsedElse) {
        this.unexpected(null, "`else` must be last case.");
      }
      if (isColon && this.state.indentLevel !== caseIndentLevel) {
        this.unexpected(null, "Mismatched indent.");
      }

      const matchCase = this.parseMatchCase(isExpression);
      if (matchCase.outerGuard && matchCase.outerGuard.type === "MatchElse") {
        hasUsedElse = true;
      }
      node.cases.push(matchCase);
    }

    if (!node.cases.length) {
      this.unexpected(null, tt.bitwiseOR);
    }

    return this.finishNode(node, isExpression ? "MatchExpression" : "MatchStatement");
  };

  pp.parseMatchCase = function (isExpression) {
    const node = this.startNode();

    this.expect(tt.bitwiseOR);
    if (this.isLineBreak()) this.unexpected(this.state.lastTokEnd, "Illegal newline.");

    this.parseMatchCaseTest(node);
    this.parseMatchCaseConsequent(node, isExpression);

    return this.finishNode(node, "MatchCase");
  };

  pp.parseMatchCaseConsequent = function(node, isExpression) {
    if (isExpression) {
      // disallow return/continue/break, etc. c/p doExpression
      const oldInFunction = this.state.inFunction;
      const oldLabels = this.state.labels;
      this.state.labels = [];
      this.state.inFunction = false;

      node.consequent = this.parseBlock(false);

      this.state.inFunction = oldInFunction;
      this.state.labels = oldLabels;
    } else {
      node.consequent = this.parseBlock(false);
    }
  };

  pp.parseMatchCaseTest = function (node) {
    // can't be nested so no need to read/restore old value
    this.state.inMatchCaseTest = true;

    if (this.match(tt._else)) {
      const elseNode = this.startNode();
      this.next();
      node.outerGuard = this.finishNode(elseNode, "MatchElse");
      this.parseMatchCaseBinding(node, true);
    } else {
      if (this.parseMatchCaseOuterGuard(node)) {
        this.parseMatchCaseAtoms(node);
        this.parseMatchCaseBinding(node);
        this.parseMatchCaseInnerGuard(node);
      }
    }

    this.state.inMatchCaseTest = false;
  };

  pp.parseMatchCaseBinding = function (node, isElse) {
    if (node.binding) this.unexpected(this.state.lastTokStart, "Cannot destructure twice.");
    if (this.eatContextual("as")) {
      node.binding = this.parseMatchBindingAtom();
      node.assertive = false;
    } else if (!isElse && this.eat(tt._with)) {
      node.binding = this.parseMatchBindingAtom();
      node.assertive = true;
    }
  };

  pp.parseMatchBindingAtom = function() {
    if (!(this.match(tt.braceL) || this.match(tt.bracketL))) {
      this.unexpected(null, "Expected an array or object destructuring pattern.");
    }
    return this.parseBindingAtom();
  };

  pp.parseMatchCaseOuterGuard = function(node) {
    if (!this.eat(tt._if)) return true;
    node.outerGuard = this.parseExpression();
    if (this.match(tt.colon)) {
      return false;
    } else {
      this.state.allowRegexMatchAtomHere = true;
      this.eatContextual("when");
      this.state.allowRegexMatchAtomHere = false;
      return true;
    }
  };

  pp.parseMatchCaseInnerGuard = function(node) {
    if (!this.eat(tt._if)) return;
    node.innerGuard = this.parseParenExpression();
  };

  pp.parseMatchCaseAtoms = function(node) {
    if (this.match(tt._if) || this.match(tt._with) || this.isContextual("as")) return;

    const atoms = [];
    this.state.inMatchAtom = true;
    while (true) {
      atoms.push(this.parseExprOps());
      if (!this.eat(tt.comma)) break;
    }
    this.state.inMatchAtom = false;

    node.atoms = atoms;
  };
}
