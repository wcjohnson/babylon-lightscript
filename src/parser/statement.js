/* eslint max-len: 0 */

import { types as tt } from "../tokenizer/types";
import Parser from "./index";
import { lineBreak } from "../util/whitespace";

const pp = Parser.prototype;

// ### Statement parsing

// Parse a program. Initializes the parser, reads any number of
// statements, and wraps them in a Program node.  Optionally takes a
// `program` argument.  If present, the statements will be appended
// to its body instead of creating a new node.

pp.parseTopLevel = function (file, program) {
  program.sourceType = this.options.sourceType;

  this.parseBlockBody(program, true, true, tt.eof);

  file.program  = this.finishNode(program, "Program");
  file.comments = this.state.comments;
  file.tokens   = this.state.tokens;

  return this.finishNode(file, "File");
};

const loopLabel = { kind: "loop" }, switchLabel = { kind: "switch" };

// TODO

pp.stmtToDirective = function (stmt) {
  const expr = stmt.expression;

  const directiveLiteral = this.startNodeAt(expr.start, expr.loc.start);
  const directive        = this.startNodeAt(stmt.start, stmt.loc.start);

  const raw = this.input.slice(expr.start, expr.end);
  const val = directiveLiteral.value = raw.slice(1, -1); // remove quotes

  this.addExtra(directiveLiteral, "raw", raw);
  this.addExtra(directiveLiteral, "rawValue", val);

  directive.value = this.finishNodeAt(directiveLiteral, "DirectiveLiteral", expr.end, expr.loc.end);

  return this.finishNodeAt(directive, "Directive", stmt.end, stmt.loc.end);
};

// Parse a single statement.
//
// If expecting a statement and finding a slash operator, parse a
// regular expression literal. This is to handle cases like
// `if (foo) /blah/.exec(foo)`, where looking at the previous token
// does not help.

pp.parseStatement = function (declaration, topLevel) {
  if (this.match(tt.at)) {
    this.parseDecorators(true);
  }

  const starttype = this.state.type;
  const node = this.startNode();
  let expr = null;
  let objParseError = null;

  const isBlock = this.state.nextBraceIsBlock;
  if (this.state.nextBraceIsBlock !== undefined) delete this.state.nextBraceIsBlock;
  const allowDirectives = this.state.nextBraceAllowDirectives;
  if (this.state.nextBraceAllowDirectives !== undefined) delete this.state.nextBraceAllowDirectives;

  // Most types of statements are recognized by the keyword they
  // start with. Many are trivial to parse, some require a bit of
  // complexity.

  switch (starttype) {
    case tt._break: case tt._continue: return this.parseBreakContinueStatement(node, starttype.keyword);
    case tt._debugger: return this.parseDebuggerStatement(node);
    case tt._do: return this.parseDoStatement(node);
    case tt._for: return this.parseForStatement(node);
    case tt._function:
      if (!declaration) this.unexpected();
      return this.parseFunctionStatement(node);

    case tt._class:
      if (!declaration) this.unexpected();
      return this.parseClass(node, true);

    case tt._if: return this.parseIfStatement(node);
    case tt._return: return this.parseReturnStatement(node);
    case tt._switch: return this.parseSwitchStatement(node);
    case tt._throw: return this.parseThrowStatement(node);
    case tt._try: return this.parseTryStatement(node);

    case tt._let:
    case tt._const:
      if (!declaration) this.unexpected(); // NOTE: falls through to _var

    case tt._var:
      return this.parseVarStatement(node, starttype);

    case tt._while: return this.parseWhileStatement(node);
    case tt._with: return this.parseWithStatement(node);
    case tt.braceL:
      if (this.hasPlugin("whiteblockOnly")) {
        // whiteblockOnly = what follows must be an ObjectExpression/Pattern
        break;
      } else if (this.hasPlugin("whiteblockPreferred") && !isBlock) {
        // whiteblockPreferred = try to parse as obj, otherwise rewind and parse as block
        const state = this.state.clone();
        try {
          expr = this.parseExpression();
          break;
        } catch (err) {
          this.state = state;
          objParseError = err;
        }

        try {
          return this.parseBlock(allowDirectives);
        } catch (err) {
          if (objParseError) {
            if (objParseError.pos > err.pos) {
              throw objParseError;
            } else if (objParseError.pos < err.pos) {
              throw err;
            } else {
              objParseError.message = "Cannot parse brace-delimited construct as an object or as a block. When parsed as an object, the error is: " + objParseError.message;
              throw objParseError;
            }
          } else {
            throw err;
          }
        }
      } else if (this.hasPlugin("lightscript") && this.isLineBreak() && !isBlock) {
        // legacy lsc behavior
        // allow line-starting `{` to be parsed as obj or obj pattern
        break;
      } else {
        return this.parseBlock(allowDirectives);
      }
    case tt.semi: return this.parseEmptyStatement(node);
    case tt._export:
    case tt._import:
      if (this.hasPlugin("dynamicImport") && this.lookahead().type === tt.parenL) break;

      if (!this.options.allowImportExportEverywhere) {
        if (!topLevel) {
          this.raise(this.state.start, "'import' and 'export' may only appear at the top level");
        }

        if (!this.inModule) {
          this.raise(this.state.start, "'import' and 'export' may appear only with 'sourceType: \"module\"'");
        }
      }
      return starttype === tt._import ? this.parseImport(node) : this.parseExport(node);

    case tt._match:
      if (this.hasPlugin("matchCoreSyntax")) return this.parseMatchStatement(node);

    case tt.name:
      if (this.state.value === "async") {
        // peek ahead and see if next token is a function
        const state = this.state.clone();
        this.next();
        if (this.match(tt._function) && !this.canInsertSemicolon()) {
          this.expect(tt._function);
          return this.parseFunction(node, true, false, true);
        } else {
          this.state = state;
        }
      }
  }

  // If the statement does not start with a statement keyword or a
  // brace, it's an ExpressionStatement or LabeledStatement. We
  // simply start parsing an expression, and afterwards, if the
  // next token is a colon and the expression was a simple
  // Identifier node, we switch to interpreting it as a label.
  const maybeName = this.state.value;
  if (!expr) expr = this.parseExpression();

  // rewrite `x = val` and `x: type = val`
  if (this.hasPlugin("lightscript") && this.isColonConstAssign(expr)) {
    const decl = this.rewriteAssignmentAsDeclarator(expr);
    node.kind = "const";
    this.addExtra(node, "implicit", true);
    node.declarations = [decl];
    this.semicolon();
    return this.finishNode(node, "VariableDeclaration");
  }

  // rewrite standalone NamedArrowExpression as NamedArrowDeclaration
  if (this.hasPlugin("lightscript") && expr.type === "NamedArrowExpression") {
    return this.finishNode(expr, "NamedArrowDeclaration");
  }

  if (starttype === tt.name && expr.type === "Identifier" && this.eat(tt.colon)) {
    return this.parseLabeledStatement(node, maybeName, expr);
  } else {
    return this.parseExpressionStatement(node, expr);
  }
};

pp.takeDecorators = function (node) {
  if (this.state.decorators.length) {
    node.decorators = this.state.decorators;
    this.state.decorators = [];
  }
};

pp.parseDecorators = function (allowExport) {
  while (this.match(tt.at)) {
    const decorator = this.parseDecorator();
    this.state.decorators.push(decorator);
  }

  if (allowExport && this.match(tt._export)) {
    return;
  }

  if (!this.match(tt._class)) {
    this.raise(this.state.start, "Leading decorators must be attached to a class declaration");
  }
};

pp.parseDecorator = function () {
  if (!this.hasPlugin("decorators")) {
    this.unexpected();
  }
  const node = this.startNode();
  this.next();
  node.expression = this.parseMaybeAssign();
  return this.finishNode(node, "Decorator");
};

pp.parseBreakContinueStatement = function (node, keyword) {
  const isBreak = keyword === "break";
  this.next();

  if (this.isLineTerminator()) {
    node.label = null;
  } else if (!this.match(tt.name)) {
    this.unexpected();
  } else {
    node.label = this.parseIdentifier();
    this.semicolon();
  }

  // Verify that there is an actual destination to break or
  // continue to.
  let i;
  for (i = 0; i < this.state.labels.length; ++i) {
    const lab = this.state.labels[i];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
      if (node.label && isBreak) break;
    }
  }
  if (i === this.state.labels.length) this.raise(node.start, "Unsyntactic " + keyword);
  return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
};

pp.parseDebuggerStatement = function (node) {
  this.next();
  this.semicolon();
  return this.finishNode(node, "DebuggerStatement");
};

pp.parseDoStatement = function (node) {
  this.next();
  this.state.labels.push(loopLabel);
  let isWhiteBlock, indentLevel;
  if (this.hasPlugin("lightscript") && this.match(tt.colon)) {
    isWhiteBlock = true;
    indentLevel = this.state.indentLevel;
  }

  this.state.nextBraceIsBlock = true;
  // LightScript: Allow `while` to terminate the whiteblock initiated by `do`.
  let oldExtraWhiteblockTerminator;
  if (this.hasPlugin("lightscript")) {
    oldExtraWhiteblockTerminator = this.state.extraWhiteblockTerminator;
    this.state.extraWhiteblockTerminator = tt._while;
  }
  node.body = this.parseStatement(false);
  this.state.labels.pop();
  if (this.hasPlugin("lightscript")) {
    this.state.extraWhiteblockTerminator = oldExtraWhiteblockTerminator;
  }

  if (this.hasPlugin("lightscript") && isWhiteBlock && this.state.indentLevel !== indentLevel) {
    this.unexpected(null, "Mismatched indent.");
  }
  this.expect(tt._while);

  // do-while can't use the lightscript-defined parseParenExpression
  // b/c it expects a trailing colon or brace, which you don't have here.

  if (this.hasPlugin("lightscript")) {
    // allow parens; enforce semicolon or newline whether they're used or not.
    node.test = this.parseExpression();
    if (node.test.extra && node.test.extra.parenthesized) {
      delete node.test.extra.parenthesized;
      delete node.test.extra.parenStart;
      this.addExtra(node, "hasParens", true);
    }
    this.semicolon();
  } else {
    node.test = this.parseParenExpression();
    this.eat(tt.semi);
  }

  return this.finishNode(node, "DoWhileStatement");
};

// Disambiguating between a `for` and a `for`/`in` or `for`/`of`
// loop is non-trivial. Basically, we have to parse the init `var`
// statement or expression, disallowing the `in` operator (see
// the second parameter to `parseExpression`), and then check
// whether the next token is `in` or `of`. When there is no init
// part (semicolon immediately after the opening parenthesis), it
// is a regular `for` loop.

pp.parseForStatement = function (node) {
  this.next();
  this.state.labels.push(loopLabel);

  let forAwait = false;
  if (this.hasPlugin("asyncGenerators") && this.state.inAsync && this.isContextual("await")) {
    forAwait = true;
    this.next();
  }

  if (this.hasPlugin("lightscript")) {
    if (this.eat(tt.parenL)) {
      this.addExtra(node, "hasParens", true);
    }
  } else {
    this.expect(tt.parenL);
  }

  if (this.match(tt.semi)) {
    if (forAwait) {
      this.unexpected();
    }
    return this.parseFor(node, null);
  }

  if (this.hasPlugin("lightscript") && (!forAwait)) {
    // idx, elem, key, or val begins a LS-enhanced loop.
    if (
      this.isContextual("idx") ||
      this.isContextual("elem") ||
      this.isContextual("key") ||
      this.isContextual("val")
    ) {
      // Disambiguate between:
      // for idx of e: body
      // for idx of in e: body
      // for idx of, elem x in e: body
      //
      // If next isn't "of", or next+1 is "in" or ",", then it's a for-in
      const nextTwo = this.tokenLookahead(2);
      if (
        (!(nextTwo[0] === tt.name && nextTwo[1] === "of")) || // next isnt of
        (nextTwo[2] === tt._in || nextTwo[2] === tt.comma) // next+1 is "in" or ","
      ) {
        return this.parseEnhancedForIn(node);
      }
    }
  }

  if (this.match(tt._var) || this.match(tt._let) || this.match(tt._const)) {
    const init = this.startNode();
    const varKind = this.state.type;
    this.next();
    this.parseVar(init, true, varKind);
    this.finishNode(init, "VariableDeclaration");

    if (this.match(tt._in) || this.isContextual("of")) {
      if (init.declarations.length === 1 && !init.declarations[0].init) {
        return this.parseForIn(node, init, forAwait);
      }
    }
    if (forAwait) {
      this.unexpected();
    }
    return this.parseFor(node, init);
  }

  const refShorthandDefaultPos = { start: 0 };
  const init = this.parseExpression(true, refShorthandDefaultPos);
  if (this.match(tt._in) || this.isContextual("of")) {
    // if (this.hasPlugin("lightscript") && (!init.isNowAssign)) {
    //   if (this.match(tt._in)) {
    //     this.raise(this.state.lastTokStart, "for-in requires a variable qualifier: `now` to reassign an existing variable, or `const`, `let`, `var` to declare a new one. Use `idx` or `elem` to iterate an array. Use `key` or `val` to iterate an object.");
    //   }
    // }

    const description = this.isContextual("of") ? "for-of statement" : "for-in statement";
    this.toAssignable(init, undefined, description);
    this.checkLVal(init, undefined, undefined, description);
    return this.parseForIn(node, init, forAwait);
  } else if (refShorthandDefaultPos.start) {
    this.unexpected(refShorthandDefaultPos.start);
  }

  if (forAwait) {
    this.unexpected();
  }

  return this.parseFor(node, init);
};

pp.parseFunctionStatement = function (node) {
  this.next();
  return this.parseFunction(node, true);
};

// overridden in LightScript

pp.parseIfStatement = function (node) {
  this.next();
  node.test = this.parseParenExpression();
  node.consequent = this.parseStatement(false);
  node.alternate = this.eat(tt._else) ? this.parseStatement(false) : null;
  return this.finishNode(node, "IfStatement");
};

pp.parseReturnStatement = function (node) {
  if (!this.state.inFunction && !this.options.allowReturnOutsideFunction) {
    this.raise(this.state.start, "'return' outside of function");
  }

  this.next();

  // In `return` (and `break`/`continue`), the keywords with
  // optional arguments, we eagerly look for a semicolon or the
  // possibility to insert one.

  if (this.isLineTerminator() || (this.hasPlugin("lightscript") && !this.state.type.startsExpr)) {
    node.argument = null;
  } else {
    node.argument = this.parseExpression();
    this.semicolon();
  }

  return this.finishNode(node, "ReturnStatement");
};

pp.parseSwitchStatement = function (node) {
  this.next();
  node.discriminant = this.parseParenExpression();
  node.cases = [];
  this.expect(tt.braceL);
  this.state.labels.push(switchLabel);

  // Statements under must be grouped (by label) in SwitchCase
  // nodes. `cur` is used to keep the node that we are currently
  // adding statements to.

  let cur;
  for (let sawDefault; !this.match(tt.braceR); ) {
    if (this.match(tt._case) || this.match(tt._default)) {
      const isCase = this.match(tt._case);
      if (cur) this.finishNode(cur, "SwitchCase");
      node.cases.push(cur = this.startNode());
      cur.consequent = [];
      this.next();
      if (isCase) {
        cur.test = this.parseExpression();
      } else {
        if (sawDefault) this.raise(this.state.lastTokStart, "Multiple default clauses");
        sawDefault = true;
        cur.test = null;
      }
      this.expect(tt.colon);
    } else {
      if (cur) {
        cur.consequent.push(this.parseStatement(true));
      } else {
        this.unexpected();
      }
    }
  }
  if (cur) this.finishNode(cur, "SwitchCase");
  this.next(); // Closing brace
  this.state.labels.pop();
  return this.finishNode(node, "SwitchStatement");
};

pp.parseThrowStatement = function (node) {
  this.next();
  if (lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start)))
    this.raise(this.state.lastTokEnd, "Illegal newline after throw");
  node.argument = this.parseExpression();
  this.semicolon();
  return this.finishNode(node, "ThrowStatement");
};

// Reused empty array added for node fields that are always empty.

const empty = [];

pp.parseTryStatement = function (node) {
  if (this.hasPlugin("enhancedTry")) {
    return this.parseTry(node, false);
  }

  this.next();

  let indentLevel, isColon;
  if (this.hasPlugin("lightscript")) {
    indentLevel = this.state.indentLevel;
    isColon = this.match(tt.colon);
    if (isColon) this.pushBlockState("try", indentLevel);
  }

  node.block = this.parseBlock();
  node.handler = null;

  const shouldParseCatch = this.match(tt._catch) && (
    !this.hasPlugin("lightscript") ||
    indentLevel === this.state.indentLevel ||
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
      if (isColon) {
        this.check(tt.colon);
      } else {
        this.check(tt.braceL);
      }
    } else {
      this.expect(tt.parenR);
    }
    clause.body = this.parseBlock();
    node.handler = this.finishNode(clause, "CatchClause");
  }

  node.guardedHandlers = empty;


  if (this.hasPlugin("lightscript")) {
    const shouldParseFinally = this.match(tt._finally) && (
      indentLevel === this.state.indentLevel ||
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

  if (!node.handler && !node.finalizer) {
    this.raise(node.start, "Missing catch or finally clause");
  }

  if (this.hasPlugin("lightscript") && isColon) this.popBlockState();

  return this.finishNode(node, "TryStatement");
};

pp.parseVarStatement = function (node, kind) {
  this.next();
  this.parseVar(node, false, kind);
  this.semicolon();
  return this.finishNode(node, "VariableDeclaration");
};

pp.parseWhileStatement = function (node) {
  this.next();
  node.test = this.parseParenExpression();
  this.state.labels.push(loopLabel);
  this.state.nextBraceIsBlock = true;
  node.body = this.parseStatement(false);
  this.state.labels.pop();
  return this.finishNode(node, "WhileStatement");
};

pp.parseWithStatement = function (node) {
  if (this.state.strict) this.raise(this.state.start, "'with' in strict mode");
  this.next();
  node.object = this.parseParenExpression();
  node.body = this.parseStatement(false);
  return this.finishNode(node, "WithStatement");
};

pp.parseEmptyStatement = function (node) {
  this.next();
  return this.finishNode(node, "EmptyStatement");
};

pp.parseLabeledStatement = function (node, maybeName, expr) {
  for (const label of (this.state.labels: Array<Object>)) {
    if (label.name === maybeName) {
      this.raise(expr.start, `Label '${maybeName}' is already declared`);
    }
  }

  const kind = this.state.type.isLoop ? "loop" : this.match(tt._switch) ? "switch" : null;
  for (let i = this.state.labels.length - 1; i >= 0; i--) {
    const label = this.state.labels[i];
    if (label.statementStart === node.start) {
      label.statementStart = this.state.start;
      label.kind = kind;
    } else {
      break;
    }
  }

  this.state.labels.push({ name: maybeName, kind: kind, statementStart: this.state.start });
  node.body = this.parseStatement(true);
  this.state.labels.pop();
  if (node.body.type === "ExpressionStatement" && this.hasPlugin("noLabeledExpressionStatements")) {
    this.raise(expr.start, "Labeled expressions are illegal.");
  }
  node.label = expr;
  return this.finishNode(node, "LabeledStatement");
};

pp.parseExpressionStatement = function (node, expr) {
  node.expression = expr;
  this.semicolon();
  return this.finishNode(node, "ExpressionStatement");
};

// Parse a semicolon-enclosed block of statements, handling `"use
// strict"` declarations when `allowStrict` is true (used for
// function bodies).

pp.parseBlock = function (allowDirectives?) {
  if (this.hasPlugin("whiteblockOnly")) {
    this.unexpected(null, "Brace-delimited blocks are illegal in whiteblock-only mode.");
  }
  const node = this.startNode();
  this.expect(tt.braceL);
  this.parseBlockBody(node, allowDirectives, false, tt.braceR);
  return this.finishNode(node, "BlockStatement");
};

pp.isValidDirective = function (stmt) {
  return stmt.type === "ExpressionStatement" &&
    stmt.expression.type === "StringLiteral" &&
    !stmt.expression.extra.parenthesized;
};

pp.parseBlockBody = function (node, allowDirectives, topLevel, end) {
  node.body = [];
  node.directives = [];

  let parsedNonDirective = false;
  let oldStrict;
  let octalPosition;

  const isEnd = () => this.eat(end);

  while (!isEnd()) {
    if (!parsedNonDirective && this.state.containsOctal && !octalPosition) {
      octalPosition = this.state.octalPosition;
    }

    const stmt = this.parseStatement(true, topLevel);

    if (allowDirectives && !parsedNonDirective && this.isValidDirective(stmt)) {
      const directive = this.stmtToDirective(stmt);
      node.directives.push(directive);

      if (oldStrict === undefined && directive.value.value === "use strict") {
        oldStrict = this.state.strict;
        this.setStrict(true);

        if (octalPosition) {
          this.raise(octalPosition, "Octal literal in strict mode");
        }
      }

      continue;
    }

    parsedNonDirective = true;
    node.body.push(stmt);
  }

  if (oldStrict === false) {
    this.setStrict(false);
  }
};

// Parse a regular `for` loop. The disambiguation code in
// `parseStatement` will already have parsed the init statement or
// expression.

pp.parseFor = function (node, init) {
  node.init = init;
  this.expect(tt.semi);
  node.test = this.match(tt.semi) ? null : this.parseExpression();
  this.expect(tt.semi);
  node.update = this.match(tt.parenR) ? null : this.parseExpression();

  if (this.hasPlugin("lightscript")) {
    this.expectParenFreeBlockStart(node);
  } else {
    this.expect(tt.parenR);
  }

  this.state.nextBraceIsBlock = true;
  node.body = this.parseStatement(false);
  this.state.labels.pop();
  return this.finishNode(node, "ForStatement");
};

// Parse a `for`/`in` and `for`/`of` loop, which are almost
// same from parser's perspective.

pp.parseForIn = function (node, init, forAwait) {
  let type;
  if (forAwait) {
    this.eatContextual("of");
    type = "ForAwaitStatement";
  } else {
    type = this.match(tt._in) ? "ForInStatement" : "ForOfStatement";
    this.next();
  }
  node.left = init;
  node.right = this.parseExpression();

  if (this.hasPlugin("lightscript")) {
    this.expectParenFreeBlockStart(node);
  } else {
    this.expect(tt.parenR);
  }

  this.state.nextBraceIsBlock = true;
  node.body = this.parseStatement(false);
  this.state.labels.pop();
  return this.finishNode(node, type);
};

// Parse a list of variable declarations.

pp.parseVar = function (node, isFor, kind) {
  node.declarations = [];
  node.kind = kind.keyword;
  for (;;) {
    const decl = this.startNode();
    this.parseVarHead(decl);
    if (this.eat(tt.eq)) {
      decl.init = this.parseMaybeAssign(isFor);
    } else if (this.hasPlugin("lightscript") && !isFor && this.match(tt.awaitArrow)) {
      decl.init = this.parseAwaitArrow(decl.id);
    } else if (kind === tt._const && !(this.match(tt._in) || this.isContextual("of"))) {
      this.unexpected();
    } else if (decl.id.type !== "Identifier" && !(isFor && (this.match(tt._in) || this.isContextual("of")))) {
      this.raise(this.state.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      decl.init = null;
    }
    node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
    if (!this.eat(tt.comma)) break;
  }
  return node;
};

pp.parseVarHead = function (decl) {
  decl.id = this.parseBindingAtom();
  this.checkLVal(decl.id, true, undefined, "variable declaration");
};

// Parse a function declaration or literal (depending on the
// `isStatement` parameter).

pp.parseFunction = function (node, isStatement, allowExpressionBody, isAsync, optionalId) {
  const oldInMethod = this.state.inMethod;
  this.state.inMethod = false;

  this.initFunction(node, isAsync);

  if (this.match(tt.star)) {
    if (node.async && !this.hasPlugin("asyncGenerators")) {
      this.unexpected();
    } else {
      node.generator = true;
      this.next();
    }
  }

  if (isStatement && !optionalId && !this.match(tt.name) && !this.match(tt._yield)) {
    this.unexpected();
  }

  if (this.match(tt.name) || this.match(tt._yield)) {
    node.id = this.parseBindingIdentifier();
  }

  this.parseFunctionParams(node);
  this.parseFunctionBody(node, allowExpressionBody);

  this.state.inMethod = oldInMethod;

  return this.finishNode(node, isStatement ? "FunctionDeclaration" : "FunctionExpression");
};

pp.parseFunctionParams = function (node) {
  this.expect(tt.parenL);
  node.params = this.parseBindingList(tt.parenR);
};

// Parse a class declaration or literal (depending on the
// `isStatement` parameter).

pp.parseClass = function (node, isStatement, optionalId) {
  this.next();
  this.takeDecorators(node);
  this.parseClassId(node, isStatement, optionalId);
  this.parseClassSuper(node);
  this.parseClassBody(node);
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
};

pp.isClassProperty = function () {
  return this.match(tt.eq) || this.match(tt.semi) || this.match(tt.braceR);
};

pp.isClassMethod = function () {
  return this.match(tt.parenL);
};

pp.isNonstaticConstructor = function (method) {
  return !method.computed && !method.static && (
    (method.key.name === "constructor") || // Identifier
    (method.key.value === "constructor")   // Literal
  );
};

pp.parseClassBody = function (node) {
  // class bodies are implicitly strict
  const oldStrict = this.state.strict;
  this.state.strict = true;

  let hadConstructorCall = false;
  let hadConstructor = false;
  let decorators = [];
  const classBody = this.startNode();

  classBody.body = [];

  let isEnd;
  if (this.hasPlugin("lightscript") && this.match(tt.colon)) {
    const indentLevel = this.state.indentLevel;
    this.next();
    isEnd = () => this.state.indentLevel <= indentLevel || this.match(tt.eof);
  } else {
    if (this.hasPlugin("whiteblockOnly")) {
      this.unexpected(null, "Brace-delimited blocks are illegal in whiteblock-only mode.");
    }
    this.expect(tt.braceL);
    isEnd = () => this.eat(tt.braceR);
  }

  while (!isEnd()) {
    if (this.eat(tt.semi)) {
      if (decorators.length > 0) {
        this.raise(this.state.lastTokEnd, "Decorators must not be followed by a semicolon");
      }
      continue;
    }

    if (this.match(tt.at)) {
      decorators.push(this.parseDecorator());
      continue;
    }

    const method = this.startNode();

    // steal the decorators if there are any
    if (decorators.length) {
      method.decorators = decorators;
      decorators = [];
    }

    method.static = false;
    if (this.match(tt.name) && this.state.value === "static") {
      const key = this.parseIdentifier(true); // eats 'static'
      if (this.isClassMethod()) {
        // a method named 'static'
        method.kind = "method";
        method.computed = false;
        method.key = key;
        this.parseClassMethod(classBody, method, false, false);
        continue;
      } else if (this.isClassProperty()) {
        // a property named 'static'
        method.computed = false;
        method.key = key;
        classBody.body.push(this.parseClassProperty(method));
        continue;
      }
      // otherwise something static
      method.static = true;
    }

    if (this.eat(tt.star)) {
      // a generator
      method.kind = "method";
      this.parsePropertyName(method);
      if (this.isNonstaticConstructor(method)) {
        this.raise(method.key.start, "Constructor can't be a generator");
      }
      if (!method.computed && method.static && (method.key.name === "prototype" || method.key.value === "prototype")) {
        this.raise(method.key.start, "Classes may not have static property named prototype");
      }
      this.parseClassMethod(classBody, method, true, false);
    } else {
      const isSimple = this.match(tt.name);
      const key = this.parsePropertyName(method);
      if (!method.computed && method.static && (method.key.name === "prototype" || method.key.value === "prototype")) {
        this.raise(method.key.start, "Classes may not have static property named prototype");
      }
      if (this.isClassMethod()) {
        // a normal method
        if (this.isNonstaticConstructor(method)) {
          if (hadConstructor) {
            this.raise(key.start, "Duplicate constructor in the same class");
          } else if (method.decorators) {
            this.raise(method.start, "You can't attach decorators to a class constructor");
          }
          hadConstructor = true;
          method.kind = "constructor";
        } else {
          method.kind = "method";
        }
        this.parseClassMethod(classBody, method, false, false);
      } else if (this.isClassProperty()) {
        // a normal property
        if (this.isNonstaticConstructor(method)) {
          this.raise(method.key.start, "Classes may not have a non-static field named 'constructor'");
        }
        classBody.body.push(this.parseClassProperty(method));
      } else if (isSimple && key.name === "async" && !this.isLineTerminator()) {
        // an async method
        const isGenerator = this.hasPlugin("asyncGenerators") && this.eat(tt.star);
        method.kind = "method";
        this.parsePropertyName(method);
        if (this.isNonstaticConstructor(method)) {
          this.raise(method.key.start, "Constructor can't be an async function");
        }
        this.parseClassMethod(classBody, method, isGenerator, true);
      } else if (isSimple && (key.name === "get" || key.name === "set") && !(this.isLineTerminator() && this.match(tt.star))) { // `get\n*` is an uninitialized property named 'get' followed by a generator.
        // a getter or setter
        method.kind = key.name;
        this.parsePropertyName(method);
        if (this.isNonstaticConstructor(method)) {
          this.raise(method.key.start, "Constructor can't have get/set modifier");
        }
        this.parseClassMethod(classBody, method, false, false);
        this.checkGetterSetterParamCount(method);
      } else if (this.hasPlugin("classConstructorCall") && isSimple && key.name === "call" && this.match(tt.name) && this.state.value === "constructor") {
        // a (deprecated) call constructor
        if (hadConstructorCall) {
          this.raise(method.start, "Duplicate constructor call in the same class");
        } else if (method.decorators) {
          this.raise(method.start, "You can't attach decorators to a class constructor");
        }
        hadConstructorCall = true;
        method.kind = "constructorCall";
        this.parsePropertyName(method); // consume "constructor" and make it the method's name
        this.parseClassMethod(classBody, method, false, false);
      } else if (this.isLineTerminator()) {
        // an uninitialized class property (due to ASI, since we don't otherwise recognize the next token)
        if (this.isNonstaticConstructor(method)) {
          this.raise(method.key.start, "Classes may not have a non-static field named 'constructor'");
        }
        classBody.body.push(this.parseClassProperty(method));
      } else {
        this.unexpected();
      }
    }
  }

  if (decorators.length) {
    this.raise(this.state.start, "You have trailing decorators with no method");
  }

  node.body = this.finishNode(classBody, "ClassBody");

  this.state.strict = oldStrict;
};

pp.parseClassProperty = function (node) {
  this.state.inClassProperty = true;
  if (this.match(tt.eq)) {
    if (!this.hasPlugin("classProperties")) this.unexpected();
    this.next();
    node.value = this.parseMaybeAssign();
  } else {
    node.value = null;
  }
  this.semicolon();
  this.state.inClassProperty = false;
  return this.finishNode(node, "ClassProperty");
};

pp.parseClassMethod = function (classBody, method, isGenerator, isAsync) {
  this.parseMethod(method, isGenerator, isAsync);
  classBody.body.push(this.finishNode(method, "ClassMethod"));
};

pp.parseClassId = function (node, isStatement, optionalId) {
  if (this.match(tt.name)) {
    node.id = this.parseIdentifier();
  } else {
    if (optionalId || !isStatement) {
      node.id = null;
    } else {
      this.unexpected(null, "A class name is required");
    }
  }
};

pp.parseClassSuper = function (node) {
  node.superClass = this.eat(tt._extends) ? this.parseExprSubscripts() : null;
};

// Parses module export declaration.

pp.parseExport = function (node) {
  this.next();
  // export * from '...'
  if (this.match(tt.star)) {
    const specifier = this.startNode();
    this.next();
    if (this.hasPlugin("exportExtensions") && this.eatContextual("as")) {
      specifier.exported = this.parseIdentifier();
      node.specifiers = [this.finishNode(specifier, "ExportNamespaceSpecifier")];
      this.parseExportSpecifiersMaybe(node);
      this.parseExportFrom(node, true);
    } else {
      this.parseExportFrom(node, true);
      return this.finishNode(node, "ExportAllDeclaration");
    }
  } else if (this.hasPlugin("exportExtensions") && this.isExportDefaultSpecifier()) {
    const specifier = this.startNode();
    specifier.exported = this.parseIdentifier(true);
    node.specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
    if (this.match(tt.comma) && this.lookahead().type === tt.star) {
      this.expect(tt.comma);
      const specifier = this.startNode();
      this.expect(tt.star);
      this.expectContextual("as");
      specifier.exported = this.parseIdentifier();
      node.specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
    } else {
      this.parseExportSpecifiersMaybe(node);
    }
    this.parseExportFrom(node, true);
  } else if (this.eat(tt._default)) { // export default ...
    let expr = this.startNode();
    let needsSemi = false;
    if (this.eat(tt._function)) {
      expr = this.parseFunction(expr, true, false, false, true);
    } else if (this.match(tt._class)) {
      expr = this.parseClass(expr, true, true);
    } else {
      needsSemi = true;
      expr = this.parseMaybeAssign();
    }
    node.declaration = expr;
    if (needsSemi) this.semicolon();
    this.checkExport(node, true, true);
    return this.finishNode(node, "ExportDefaultDeclaration");
  } else if (this.shouldParseExportDeclaration()) {
    node.specifiers = [];
    node.source = null;
    node.declaration = this.parseExportDeclaration(node);
  } else { // export { x, y as z } [from '...']
    node.declaration = null;
    node.specifiers = this.parseExportSpecifiers();
    this.parseExportFrom(node);
  }
  this.checkExport(node, true);
  return this.finishNode(node, "ExportNamedDeclaration");
};

pp.parseExportDeclaration = function () {
  return this.parseStatement(true);
};

pp.isExportDefaultSpecifier = function () {
  if (this.match(tt.name)) {
    return this.state.value !== "async";
  }

  if (!this.match(tt._default)) {
    return false;
  }

  const lookahead = this.lookahead();
  return lookahead.type === tt.comma || (lookahead.type === tt.name && lookahead.value === "from");
};

pp.parseExportSpecifiersMaybe = function (node) {
  if (this.eat(tt.comma)) {
    node.specifiers = node.specifiers.concat(this.parseExportSpecifiers());
  }
};

pp.parseExportFrom = function (node, expect?) {
  if (this.eatContextual("from")) {
    node.source = this.match(tt.string) ? this.parseExprAtom() : this.unexpected();
    this.checkExport(node);
  } else {
    if (expect) {
      this.unexpected();
    } else {
      node.source = null;
    }
  }

  this.semicolon();
};

pp.shouldParseExportDeclaration = function (): boolean {
  return this.state.type.keyword === "var"
    || this.state.type.keyword === "const"
    || this.state.type.keyword === "let"
    || this.state.type.keyword === "function"
    || this.state.type.keyword === "class"
    || this.isContextual("async");
};

pp.checkExport = function (node, checkNames, isDefault) {
  if (checkNames) {
    // Check for duplicate exports
    if (isDefault) {
      // Default exports
      this.checkDuplicateExports(node, "default");
    } else if (node.specifiers && node.specifiers.length) {
      // Named exports
      for (const specifier of node.specifiers) {
        this.checkDuplicateExports(specifier, specifier.exported.name);
      }
    } else if (node.declaration) {
      // Exported declarations
      if (node.declaration.type === "FunctionDeclaration" || node.declaration.type === "ClassDeclaration") {
        this.checkDuplicateExports(node, node.declaration.id.name);
      } else if (node.declaration.type === "VariableDeclaration") {
        for (const declaration of node.declaration.declarations) {
          this.checkDeclaration(declaration.id);
        }
      }
    }
  }

  if (this.state.decorators.length) {
    const isClass = node.declaration && (node.declaration.type === "ClassDeclaration" || node.declaration.type === "ClassExpression");
    if (!node.declaration || !isClass) {
      this.raise(node.start, "You can only use decorators on an export when exporting a class");
    }
    this.takeDecorators(node.declaration);
  }
};

pp.checkDeclaration = function(node) {
  if (node.type === "ObjectPattern") {
    for (const prop of node.properties) {
      this.checkDeclaration(prop);
    }
  } else if (node.type === "ArrayPattern") {
    for (const elem of node.elements) {
      if (elem) {
        this.checkDeclaration(elem);
      }
    }
  } else if (node.type === "ObjectProperty") {
    this.checkDeclaration(node.value);
  } else if (node.type === "RestElement" || node.type === "RestProperty") {
    this.checkDeclaration(node.argument);
  } else if (node.type === "Identifier") {
    this.checkDuplicateExports(node, node.name);
  }
};

pp.checkDuplicateExports = function(node, name) {
  if (this.state.exportedIdentifiers.indexOf(name) > -1) {
    this.raiseDuplicateExportError(node, name);
  }
  this.state.exportedIdentifiers.push(name);
};

pp.raiseDuplicateExportError = function(node, name) {
  this.raise(node.start, name === "default" ?
    "Only one default export allowed per module." :
    `\`${name}\` has already been exported. Exported identifiers must be unique.`
  );
};

// Parses a comma-separated list of module exports.

pp.parseExportSpecifiers = function () {
  const nodes = [];
  let first = true;
  let needsFrom;

  // export { x, y as z } [from '...']
  this.expect(tt.braceL);

  while (!this.eat(tt.braceR)) {
    if (first) {
      first = false;
    } else {
      if (this.hasPlugin("lightscript")) {
        this.expectCommaOrLineBreak();
      } else {
        this.expect(tt.comma);
      }
      if (this.eat(tt.braceR)) break;
    }

    const isDefault = this.match(tt._default);
    if (isDefault && !needsFrom) needsFrom = true;

    const node = this.startNode();
    node.local = this.parseIdentifier(isDefault);
    node.exported = this.eatContextual("as") ? this.parseIdentifier(true) : node.local.__clone();
    nodes.push(this.finishNode(node, "ExportSpecifier"));
  }

  // https://github.com/ember-cli/ember-cli/pull/3739
  if (needsFrom && !this.isContextual("from")) {
    this.unexpected();
  }

  return nodes;
};

// Parses import declaration.

pp.parseImport = function (node) {
  this.eat(tt._import);

  // import 'foo'
  if (this.match(tt.string)) {
    node.specifiers = [];
    node.source = this.parseExprAtom();

    // import 'foo': a, { b, c, d as e }
    if (this.hasPlugin("flippedImports") && this.eat(tt.colon)) {
      this.parseImportSpecifiers(node);
    }
  } else {
    node.specifiers = [];
    this.parseImportSpecifiers(node);
    this.expectContextual("from");
    node.source = this.match(tt.string) ? this.parseExprAtom() : this.unexpected();
  }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration");
};

// Parses a comma-separated list of module imports.

pp.parseImportSpecifiers = function (node) {
  let first = true;
  if (this.match(tt.name)) {
    // import defaultObj, { x, y as z } from '...'
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    node.specifiers.push(this.parseImportSpecifierDefault(this.parseIdentifier(), startPos, startLoc));
    if (!this.eat(tt.comma)) return;
  }

  if (this.match(tt.star)) {
    const specifier = this.startNode();
    this.next();
    this.expectContextual("as");
    specifier.local = this.parseIdentifier();
    this.checkLVal(specifier.local, true, undefined, "import namespace specifier");
    node.specifiers.push(this.finishNode(specifier, "ImportNamespaceSpecifier"));
    return;
  }

  this.expect(tt.braceL);
  while (!this.eat(tt.braceR)) {
    if (first) {
      first = false;
    } else {
      // Detect an attempt to deep destructure
      if (this.eat(tt.colon)) {
        this.unexpected(null, "ES2015 named imports do not destructure. Use another statement for destructuring after the import.");
      }

      if (this.hasPlugin("lightscript")) {
        this.expectCommaOrLineBreak();
      } else {
        this.expect(tt.comma);
      }
      if (this.eat(tt.braceR)) break;
    }

    this.parseImportSpecifier(node);
  }
};

pp.parseImportSpecifier = function (node) {
  const specifier = this.startNode();
  specifier.imported = this.parseIdentifier(true);
  if (this.eatContextual("as")) {
    specifier.local = this.parseIdentifier();
  } else {
    this.checkReservedWord(specifier.imported.name, specifier.start, true, true);
    specifier.local = specifier.imported.__clone();
  }
  this.checkLVal(specifier.local, true, undefined, "import specifier");
  node.specifiers.push(this.finishNode(specifier, "ImportSpecifier"));
};

pp.parseImportSpecifierDefault = function (id, startPos, startLoc) {
  const node = this.startNodeAt(startPos, startLoc);
  node.local = id;
  this.checkLVal(node.local, true, undefined, "default import specifier");
  return this.finishNode(node, "ImportDefaultSpecifier");
};
