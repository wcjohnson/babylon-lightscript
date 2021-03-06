import Parser from "../parser";
import { types as tt } from "../tokenizer/types";

const pp = Parser.prototype;

pp.isColonConstAssign = function (expr) {
  if (expr.type !== "AssignmentExpression") return false;
  if (expr.left.type === "MemberExpression") return false;
  if (expr.isNowAssign !== false) return false;

  return (
    expr.operator === "=" || expr.operator === "<-" || expr.operator === "<!-"
  );
};

pp.rewriteAssignmentAsDeclarator = function (node) {
  node.type = "VariableDeclarator";
  node.id = node.left;
  node.init = node.right;
  delete node.left;
  delete node.operator;
  delete node.right;
  delete node.isNowAssign;
  return node;
};

// Must unwind state after calling this!
// c/p parseVar and parseVarStatement


pp.tryParseAutoConst = function () {
  const node = this.startNode(), decl = this.startNode();
  try {
    this.parseVarHead(decl);
  } catch (err) {
    return null;
  }

  if (!this.eat(tt.eq)) return null;

  try {
    decl.init = this.parseMaybeAssign();
  } catch (err) {
    return null;
  }

  node.declarations = [this.finishNode(decl, "VariableDeclarator")];
  node.kind = "const";
  this.semicolon();

  return this.finishNode(node, "VariableDeclaration");
};

const REMAPPED_OPERATORS = {
  "!=": "!==",
  "==": "===",
  "or": "||",
  "and": "&&",
  "not": "!",
};

pp.rewriteOperator = function (node) {
  if (REMAPPED_OPERATORS[node.operator]) {
    node.operator = REMAPPED_OPERATORS[node.operator];
  }
};

const MATCHING_ITER_VARS = {
  "idx": "elem",
  "elem": "idx",
  "key": "val",
  "val": "key",
};

pp.parseForInIterationVariable = function (node, targetType = null) {
  const iterType = this.state.value;
  if (targetType && targetType !== iterType) {
    this.unexpected(null, `Unexpected token, expected ${targetType}`);
  }

  this.next();
  node[iterType] = iterType === "elem" || iterType === "val"
    ? this.parseBindingAtom()
    : this.parseBindingIdentifier();
  return MATCHING_ITER_VARS[iterType];
};

pp.parseEnhancedForIn = function (node) {
  const matchingIterationType = this.parseForInIterationVariable(node);
  if (this.eat(tt.comma)) {
    this.parseForInIterationVariable(node, matchingIterationType);
  }

  this.expect(tt._in);

  const iterable = this.parseMaybeAssign(true);

  this.expectParenFreeBlockStart(node);
  this.state.nextBraceIsBlock = true;
  node.body = this.parseStatement(false);

  if ((matchingIterationType === "idx") || (matchingIterationType === "elem")) {
    node.array = iterable;
    return this.finishNode(node, "ForInArrayStatement");
  } else {
    node.object = iterable;
    return this.finishNode(node, "ForInObjectStatement");
  }
};

pp.expectParenFreeBlockStart = function (node) {
  // if true: blah
  // if true { blah }
  // if (true) blah
  // match (foo) as bar:
  if (node && node.extra && node.extra.hasParens) {
    this.expect(tt.parenR);
  } else if (!(this.match(tt.colon) || this.match(tt.braceL) || this.isContextual("as"))) {
    this.unexpected(null, "Paren-free test expressions must be followed by braces or a colon.");
  }
};

pp.matchesWhiteBlockASIToken = function() {
  return (
    (this.match(tt.comma) && this.hasPlugin("seqExprRequiresParen")) ||
    this.match(tt.parenR) ||
    this.match(tt.bracketR) ||
    this.match(tt.braceR) ||
    this.match(tt.colon) ||
    this.match(tt._else) ||
    this.match(tt._elif) ||
    this.match(tt._catch) ||
    this.match(tt._finally) ||
    (this.state.extraWhiteblockTerminator && this.match(this.state.extraWhiteblockTerminator)) ||
    this.match(tt.eof)
  );
};

// c/p statement.js parseBlockBody
pp.parseWhiteBlockBody = function (node, allowDirectives, topLevel, whiteBlockIndentLevel) {
  node.body = [];
  node.directives = [];

  let parsedNonDirective = false;
  let oldStrict;
  let octalPosition;

  const oldInWhiteBlock = this.state.inWhiteBlock;
  const oldWhiteBlockIndentLevel = this.state.whiteBlockIndentLevel;
  this.state.inWhiteBlock = true;
  this.state.whiteBlockIndentLevel = whiteBlockIndentLevel;

  const isEnd = () => this.state.indentLevel <= whiteBlockIndentLevel || this.matchesWhiteBlockASIToken();

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

  this.state.inWhiteBlock = oldInWhiteBlock;
  this.state.whiteBlockIndentLevel = oldWhiteBlockIndentLevel;

  if (oldStrict === false) {
    this.setStrict(false);
  }
};

pp.parseInlineWhiteBlock = function(node) {
  if (this.state.type.startsExpr) return this.parseMaybeAssign();
  // oneline statement case
  node.body = [this.parseStatement(true)];
  node.directives = [];
  this.addExtra(node, "curly", false);
  return this.finishNode(node, "BlockStatement");
};

pp.parseMultilineWhiteBlock = function(node, indentLevel) {
  this.parseWhiteBlockBody(node, false, false, indentLevel);
  if (!node.body.length) {
    this.unexpected(node.start, "Expected an Indent or Statement");
  }
  this.addExtra(node, "curly", false);
  return this.finishNode(node, "BlockStatement");
};

pp.parseWhiteBlock = function (isExpression?) {
  const node = this.startNode(), indentLevel = this.state.indentLevel;
  if (!this.eat(tt.colon)) this.unexpected(this.state.lastTokEnd, tt.colon);

  // Oneline whiteblock
  if (!this.isLineBreak()) {
    if (isExpression) {
      return this.parseInlineWhiteBlock(node);
    }

    const stmt = this.parseStatement(false);
    return stmt;
  }

  // TODO: document the fact that directives aren't parsed
  return this.parseMultilineWhiteBlock(node, indentLevel);
};

pp.crossesWhiteBlockBoundary = function() {
  return (this.state.inWhiteBlock && this.state.indentLevel <= this.state.whiteBlockIndentLevel);
};

pp.expectCommaOrLineBreak = function (loc = null) {
  // TODO: consider error message like "Missing comma or newline."
  if (!(this.eat(tt.comma) || this.isLineBreak())) this.unexpected(loc, tt.comma);
};

// Arguably one of the hackiest parts of LightScript so far.
pp.seemsLikeStatementStart = function () {
  const lastTok = this.state.tokens[this.state.tokens.length - 1];
  if (lastTok && lastTok.type === tt.semi) return true;
  if (lastTok && lastTok.type === tt.braceR) return true;

  // This is not accurate; could easily be a continuation of a previous expression.
  if (this.isLineBreak()) return true;
};

pp.parseArrowType = function (node) {
  if (!this.match(tt.arrow)) return;
  const val = this.state.value;

  // validations
  const isPlainFatArrow = val === "=>" && !node.id && !node.key;
  if (node.async && !isPlainFatArrow) this.unexpected(node.start, "Can't use async with lightscript arrows.");
  if (node.generator) this.unexpected(node.start, "Can't declare generators with arrows; try -*> instead.");
  if (node.kind === "constructor" && val !== "->") this.unexpected(null, "Can only use -> with constructor.");

  if ((node.kind === "get" || node.kind === "set") && val !== "->") {
    this.unexpected(node.start, "Can only use -> with getters & setters.");
  }

  switch (val) {
    case "=/>": case "-/>":
      node.async = true;
      break;
    case "=*>": case "-*>":
      node.generator = true;
      break;
    case "=*/>": case "-*/>":
      node.async = true;
      node.generator = true;
      break;
    case "=>": case "->":
      break;
    default:
      this.unexpected();
  }

  if (val[0] === "-") {
    node.skinny = true;
  } else if (val[0] === "=") {
    node.skinny = false;
  } else {
    this.unexpected();
  }
};

pp.parseBraceArrowFunctionBody = function() {
  this.state.nextBraceAllowDirectives = true;
  const node = this.parseStatement(true);
  if (node.type === "ExpressionStatement") {
    return node.expression;
  } else {
    return node;
  }
};

pp.parseArrowFunctionBody = function (node) {
  // set and reset state surrounding block
  const oldInAsync = this.state.inAsync,
    oldInGen = this.state.inGenerator,
    oldLabels = this.state.labels,
    oldInFunc = this.state.inFunction;
  this.state.inAsync = node.async;
  this.state.inGenerator = node.generator;
  this.state.labels = [];
  this.state.inFunction = true;

  const indentLevel = this.state.indentLevel;
  const nodeAtArrow = this.startNode();
  this.expect(tt.arrow);
  if (!this.isLineBreak()) {
    if (this.match(tt.braceL)) {
      node.body = this.parseBraceArrowFunctionBody(this.startNode(), indentLevel);
    } else {
      node.body = this.parseInlineWhiteBlock(nodeAtArrow);
    }
  } else {
    node.body = this.parseMultilineWhiteBlock(nodeAtArrow, indentLevel);
  }

  if (node.body.type !== "BlockStatement") {
    node.expression = true;
  }

  this.state.inAsync = oldInAsync;
  this.state.inGenerator = oldInGen;
  this.state.labels = oldLabels;
  this.state.inFunction = oldInFunc;

  this.validateFunctionBody(node, true);
};

pp.parseNamedArrowFromCallExpression = function (node, call) {
  this.initFunction(node);
  node.params = this.toAssignableList(call.arguments, true, "named arrow function parameters");
  if (call.typeParameters) node.typeParameters = call.typeParameters;

  let isMember;
  if (call.callee.type === "Identifier") {
    node.id = call.callee;
    isMember = false;
  } else if (call.callee.type === "MemberExpression") {
    node.id = call.callee.property;
    node.object = call.callee.object;
    isMember = true;
  } else {
    this.unexpected();
  }

  if (this.match(tt.colon)) {
    const oldNoAnonFunctionType = this.state.noAnonFunctionType;
    this.state.noAnonFunctionType = true;
    node.returnType = this.flowParseTypeAnnotation();
    this.state.noAnonFunctionType = oldNoAnonFunctionType;
  }
  if (this.canInsertSemicolon()) this.unexpected();

  this.check(tt.arrow);
  this.parseArrowType(node);
  try {
    this.parseArrowFunctionBody(node);
  } catch (err) {
    err._errorWasInFunctionBody = true;
    throw err;
  }

  // may be later rewritten as "NamedArrowDeclaration" in parseStatement
  return this.finishNode(node, isMember ? "NamedArrowMemberExpression" : "NamedArrowExpression");
};

// c/p parseIfStatement
pp.parseIf = function (node, isExpression, requireColon = null) {
  const indentLevel = this.state.indentLevel;
  this.next();
  node.test = this.parseParenExpression();

  const isColon = requireColon
    ? this.check(tt.colon)
    : this.match(tt.colon);

  // colon not allowed, parent `if` didn't use one.
  if (isColon && requireColon === false) this.expect(tt.braceL);

  if (isColon) this.pushBlockState("if", indentLevel);

  if (isExpression) {
    // disallow return/continue/break, etc. c/p doExpression
    const oldInFunction = this.state.inFunction;
    const oldLabels = this.state.labels;
    this.state.labels = [];
    this.state.inFunction = false;

    if (this.match(tt.braceL)) {
      node.consequent = this.parseBlock(false);
    } else if (!isColon) {
      node.consequent = this.parseMaybeAssign();
    } else {
      node.consequent = this.parseWhiteBlock(true);
    }

    this.state.inFunction = oldInFunction;
    this.state.labels = oldLabels;
  } else {
    this.state.nextBraceIsBlock = true;
    node.consequent = this.parseStatement(false);
  }

  node.alternate = this.parseIfAlternate(node, isExpression, isColon, indentLevel);

  if (isColon) this.popBlockState();

  return this.finishNode(node, isExpression ? "IfExpression" : "IfStatement");
};

pp.parseIfAlternate = function (node, isExpression, ifIsWhiteBlock, ifIndentLevel) {
  if (!this.match(tt._elif) && !this.match(tt._else)) return null;

  // If the indent level here doesn't match with the current whiteblock `if`, or
  // it matches with a whiteblock `if` higher on the stack, then this alternate
  // clause does not match the current `if` -- so unwind the recursive descent.
  const alternateIndentLevel = this.state.indentLevel;
  if (
    (alternateIndentLevel !== ifIndentLevel) &&
    (ifIsWhiteBlock || this.matchBlockState("if", alternateIndentLevel))
  ) {
    return null;
  }

  if (this.match(tt._elif)) {
    return this.parseIf(this.startNode(), isExpression, ifIsWhiteBlock);
  }

  if (this.eat(tt._else)) {
    if (this.match(tt._if)) {
      if (this.isLineBreak()) {
        this.unexpected(this.state.lastTokEnd, "Illegal newline.");
      }
      return this.parseIf(this.startNode(), isExpression, ifIsWhiteBlock);
    }

    if (ifIsWhiteBlock) {
      return this.parseWhiteBlock(isExpression);
    } else if (this.match(tt.colon)) {
      this.expect(tt.braceL);
    }

    if (isExpression) {
      if (this.match(tt.braceL)) {
        return this.parseBlock(false);
      } else {
        return this.parseMaybeAssign();
      }
    }

    this.state.nextBraceIsBlock = true;
    return this.parseStatement(false);
  }

  return null;
};

pp.parseIfExpression = function (node) {
  return this.parseIf(node, true);
};


// c/p parseAwait

pp.parseSafeAwait = function (node) {
  if (!this.state.inAsync) {
    this.unexpected(this.state.lastTokStart, "Safe await is illegal outside of an async function.");
  }
  node.argument = this.parseMaybeUnary();
  return this.finishNode(node, "SafeAwaitExpression");
};

pp.isAwaitArrowAssign = function (expr) {
  return (
    expr.type === "AssignmentExpression" &&
    (expr.operator === "<-" || expr.operator === "<!-")
  );
};

pp.parseAwaitArrow = function (left) {
  const node = this.startNode();
  const arrowType = this.state.value;
  const arrowPos = this.state.pos;
  this.next();
  if (arrowType === "<!-") {
    if (left.type === "ObjectPattern" || left.type === "ArrayPattern") {
      this.unexpected(arrowPos - 3, "Destructuring is not allowed with '<!-'.");
    }
    return this.parseSafeAwait(node);
  } else {
    return this.parseAwait(node);
  }
};

pp.tryParseNamedArrowDeclaration = function () {
  let node = this.startNode();
  const call = this.startNode();

  if (!this.match(tt.name)) return null;
  if (this.state.value === "type") return null;
  try {
    call.callee = this.parseIdentifier();
  } catch (err) {
    return null;
  }


  // parse eg; `fn<T>() ->`
  if (this.hasPlugin("flow") && this.isRelational("<")) {
    try {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } catch (err) {
      return null;
    }
  }

  if (!this.eat(tt.parenL)) return null;
  try {
    call.arguments = this.parseCallExpressionArguments(tt.parenR, false);
  } catch (err) {
    return null;
  }

  if (!this.shouldParseArrow()) return null;
  node = this.parseNamedArrowFromCallExpression(node, call);

  // Declaration, not Expression
  node.type = "NamedArrowDeclaration";
  return node;
};

pp.isBitwiseOp = function () {
  return (
    this.match(tt.bitwiseOR) ||
    this.match(tt.bitwiseAND) ||
    this.match(tt.bitwiseXOR) ||
    this.match(tt.bitShift)
  );
};

export default function (instance) {

  // if, switch, while, with --> don't need no stinkin' parens no more

  instance.extend("parseParenExpression", function (inner) {
    return function () {
      if (this.isLineBreak()) {
        this.unexpected(this.state.lastTokEnd, "Illegal newline.");
      }

      // parens are special here; they might be `if (x) -1` or `if (x < 1) and y: -1`
      if (this.match(tt.parenL)) {
        const state = this.state.clone();

        // first, try paren-free style
        try {
          const val = this.parseExpression();
          if (this.match(tt.braceL) || this.match(tt.colon)) {
            if (val.extra && val.extra.parenthesized) {
              delete val.extra.parenthesized;
              delete val.extra.parenStart;
            }
            return val;
          }
        } catch (_err) {
          // fall-through, will re-raise if it's an error below
        }

        // Could have been an un-parenthesized SeqExpr
        if (this.hasPlugin("seqExprRequiresParen") && this.match(tt.comma)) {
          this.unexpected();
        }

        // otherwise, try traditional parseParenExpression
        this.state = state;
        return inner.apply(this, arguments);
      }

      const val = this.parseExpression();
      this.expectParenFreeBlockStart();
      return val;
    };
  });

  // `export` is the only time auto-const and can be preceded by a non-newline,
  // and has a bunch of weird parsing rules generally.

  instance.extend("parseExport", function (inner) {
    return function (node) {
      let state = this.state.clone();

      // first try NamedArrowDeclaration
      // eg; `export fn() -> 1`, `export fn<T>(x: T): T -> x`
      this.next();
      if (this.match(tt.name)) {
        const decl = this.tryParseNamedArrowDeclaration();
        if (decl) {
          node.specifiers = [];
          node.source = null;
          node.declaration = decl;
          this.checkExport(node, true);
          return this.finishNode(node, "ExportNamedDeclaration");
        }
      }

      // wasn't a NamedArrowDeclaration, reset.
      this.state = state;
      state = this.state.clone();

      // next, try auto-const
      // eg; `export x = 7`, `export { x, y }: Point = a`
      this.next();
      if (this.match(tt.name) || this.match(tt.bracketL) || this.match(tt.braceL)) {
        const decl = this.tryParseAutoConst();
        if (decl) {
          node.specifiers = [];
          node.source = null;
          node.declaration = decl;
          this.checkExport(node, true);
          return this.finishNode(node, "ExportNamedDeclaration");
        }
      }

      this.state = state;
      return inner.apply(this, arguments);
    };
  });

  // whitespace following a colon

  instance.extend("parseStatement", function (inner) {
    return function () {
      if (this.match(tt.colon)) {
        delete this.state.nextBraceIsBlock;
        return this.parseWhiteBlock();
      }
      return inner.apply(this, arguments);
    };
  });

  // whitespace following a colon

  instance.extend("parseBlock", function (inner) {
    return function () {
      if (this.match(tt.colon)) {
        return this.parseWhiteBlock();
      }
      if (this.hasPlugin("whiteblockOnly")) {
        this.unexpected(null, tt.colon);
      }
      const block = inner.apply(this, arguments);
      this.addExtra(block, "curly", true);
      return block;
    };
  });

  instance.extend("parseIfStatement", function () {
    return function (node) {
      return this.parseIf(node, false);
    };
  });

}
