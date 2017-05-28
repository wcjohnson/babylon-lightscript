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
  if (node && node.extra && node.extra.hasParens) {
    this.expect(tt.parenR);
  } else if (!(this.match(tt.colon) || this.match(tt.braceL))) {
    this.unexpected(null, "Paren-free test expressions must be followed by braces or a colon.");
  }
};

// [for ...: stmnt]

pp.parseArrayComprehension = function (node) {
  const loop = this.startNode();
  node.loop = this.parseForStatement(loop);
  this.expect(tt.bracketR);
  return this.finishNode(node, "ArrayComprehension");
};

pp.parseObjectComprehension = function(node) {
  const loop = this.startNode();
  node.loop = this.parseForStatement(loop);
  this.expect(tt.braceR);
  return this.finishNode(node, "ObjectComprehension");
};

pp.couldBeginStatement = function() {
  // ExpressionStatement
  if (this.state.type.startsExpr) return true;

  // c/p from parseStatement
  switch (this.state.type) {
    case tt._break:
    case tt._continue:
    case tt._debugger:
    case tt._do:
    case tt._for:
    case tt._function:
    case tt._class:
    case tt._if:
    case tt._return:
    case tt._switch:
    case tt._throw:
    case tt._try:
    case tt._let:
    case tt._const:
    case tt._var:
    case tt._now:
    case tt._while:
    case tt._with:
    case tt.braceL:
    case tt.semi:
    case tt._export:
    case tt._import:
    case tt.name:
      return true;
  }

  return false;
};

pp.finishWhiteBlock = function(node, allowEmptyBody) {
  if (!allowEmptyBody && !node.body.length) {
    this.unexpected(node.start, "Expected an Indent or Statement");
  }

  this.addExtra(node, "curly", false);
  return this.finishNode(node, "BlockStatement");
};

pp.parseInlineWhiteBlock = function(node, allowEmptyBody) {
  if (this.state.type.startsExpr) return this.parseMaybeAssign();
  // oneline statement case
  node.body = this.couldBeginStatement() ? [this.parseStatement(true)] : [];
  node.directives = [];
  return this.finishWhiteBlock(node, allowEmptyBody);
};

pp.parseMultilineWhiteBlock = function(node, indentLevel, allowEmptyBody) {
  this.parseBlockBody(node, false, false, indentLevel);
  return this.finishWhiteBlock(node, allowEmptyBody);
};

pp.parseWhiteBlock = function (isExpression?) {
  const node = this.startNode(), indentLevel = this.state.indentLevel;

  if (!this.eat(tt.colon)) this.unexpected(null, "Whitespace Block must start with a colon or arrow");

  // Oneline whiteblock
  if (!this.isLineBreak()) {
    if (isExpression) {
      return this.parseInlineWhiteBlock(node, false);
    } else {
      return this.parseStatement(false);
    }
  }

  // TODO: document the fact that directives aren't parsed
  return this.parseMultilineWhiteBlock(node, indentLevel, false);
};

pp.expectCommaOrLineBreak = function () {
  // TODO: consider error message like "Missing comma or newline."
  if (!(this.eat(tt.comma) || this.isLineBreak())) this.unexpected(null, tt.comma);
};

// lightscript only allows plain space (ascii-32), \r\n, and \n.
// note that the space could appear within a string.

pp.isWhitespaceAt = function (pos) {
  const ch = this.state.input.charCodeAt(pos);
  return (ch === 32 || ch === 13 || ch === 10);
};

pp.isNextCharWhitespace = function () {
  return this.isWhitespaceAt(this.state.end);
};

// Arguably one of the hackiest parts of LightScript so far.

pp.seemsLikeStatementStart = function () {
  const lastTok = this.state.tokens[this.state.tokens.length - 1];
  if (lastTok && lastTok.type === tt.semi) return true;
  if (lastTok && lastTok.type === tt.braceR) return true;

  // This is not accurate; could easily be a continuation of a previous expression.
  if (this.isLineBreak()) return true;
};

pp.isFollowedByLineBreak = function () {
  const end = this.state.input.length;

  let pos = this.state.pos;
  while (pos < end) {
    const code = this.state.input.charCodeAt(pos);
    if (code === 10) {
      return true;
    } else if (code === 32 || code === 13) {
      ++pos;
      continue;
    } else {
      return false;
    }
  }
};

// detect whether we're on a (non-indented) newline
// relative to another position, eg;
// x y -> false
// x\ny -> true
// x\n  y -> false

pp.isNonIndentedBreakFrom = function (pos) {
  const indentLevel = this.indentLevelAt(pos);
  return this.isLineBreak() && this.state.indentLevel <= indentLevel;
};

// walk backwards til newline or start-of-file.
// if two consecutive spaces are found together, increment indents.
// if non-space found, reset indentation.

pp.indentLevelAt = function (pos) {
  let indents = 0;
  while (pos > 0 && this.state.input[pos] !== "\n") {
    if (this.state.input[pos--] === " ") {
      if (this.state.input[pos] === " ") {
        --pos;
        ++indents;
      }
    } else {
      indents = 0;
    }
  }
  return indents;
};

pp.parseArrowType = function (node) {
  if (!this.match(tt.arrow)) return;
  const val = this.state.value;

  // validations
  const isPlainFatArrow = val === "=>" && !node.id && !node.key;
  if (node.async && !isPlainFatArrow) this.unexpected(node.start, "Can't use async with lightscript arrows.");
  if (node.generator) this.unexpected(node.start, "Can't declare generators with arrows; try -*> instead.");
  if (node.kind === "get") this.unexpected(node.start, "Can't use arrow method with get; try -get> instead.");
  if (node.kind === "set") this.unexpected(node.start, "Can't use arrow method with set; try -set> instead.");
  if (node.kind === "constructor" && val !== "->") this.unexpected(null, "Can only use -> with constructor.");

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
    case "-get>":
      // TODO: validate that it's in a method not a function
      if (!node.kind) this.unexpected(null, "Only methods can be getters.");
      node.kind = "get";
      break;
    case "-set>":
      if (!node.kind) this.unexpected(null, "Only methods can be setters.");
      node.kind = "set";
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

// largely c/p from parseFunctionBody

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
  node.body = this.startNode();
  this.expect(tt.arrow);
  if (!this.isLineBreak()) {
    if (this.match(tt.braceL)) {
      // restart node at brace start instead of arrow start
      node.body = this.startNode();
      this.next();
      this.parseBlockBody(node.body, true, false, tt.braceR);
      this.addExtra(node.body, "curly", true);
      node.body = this.finishNode(node.body, "BlockStatement");
    } else {
      node.body = this.parseInlineWhiteBlock(node.body, true);
    }
  } else {
    node.body = this.parseMultilineWhiteBlock(node.body, indentLevel, true);
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
  this.parseArrowFunctionBody(node);

  // may be later rewritten as "NamedArrowDeclaration" in parseStatement
  return this.finishNode(node, isMember ? "NamedArrowMemberExpression" : "NamedArrowExpression");
};

pp.pushBlockState = function (blockType, indentLevel) {
  this.state.blockStack.push({ blockType, indentLevel });
};

pp.matchBlockState = function(blockType, indentLevel) {
  return this.state.blockStack.some( (x) => x.blockType === blockType && x.indentLevel === indentLevel );
};

pp.popBlockState = function() {
  this.state.blockStack.pop();
};

// c/p parseIfStatement

pp.parseIf = function (node, isExpression) {
  const indentLevel = this.state.indentLevel;
  this.next();
  node.test = this.parseParenExpression();

  const isColon = this.match(tt.colon);
  if (isColon) this.pushBlockState("if", indentLevel);

  if (isExpression) {
    if (this.match(tt.braceL)) {
      node.consequent = this.parseBlock(false);
    } else if (!isColon) {
      node.consequent = this.parseMaybeAssign();
    } else {
      node.consequent = this.parseWhiteBlock(true);
    }
  } else {
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
    return this.parseIf(this.startNode(), isExpression);
  }

  if (this.eat(tt._else)) {
    if (this.match(tt._if)) {
      if (this.isLineBreak()) {
        this.unexpected(this.state.lastTokEnd, "Illegal newline.");
      }
      return this.parseIf(this.startNode(), isExpression);
    }

    if (this.isLineBreak()) {
      this.unexpected(this.state.lastTokEnd, tt.colon);
    }

    if (isExpression) {
      if (this.match(tt.braceL)) {
        return this.parseBlock(false);
      } else if (!this.match(tt.colon)) {
        return this.parseMaybeAssign();
      } else {
        return this.parseWhiteBlock(true);
      }
    }

    return this.parseStatement(false);
  }

  return null;
};

pp.parseIfExpression = function (node) {
  return this.parseIf(node, true);
};


// c/p parseAwait

pp.parseSafeAwait = function (node) {
  if (!this.state.inAsync) this.unexpected();
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
  this.next();
  if (arrowType === "<!-") {
    if (left.type === "ObjectPattern" || left.type === "ArrayPattern") {
      this.unexpected(left.start, "Destructuring is not allowed with '<!-'.");
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

pp.parseSafeCall = function(expr, startPos, startLoc) {
  this.expect(tt.parenL);
  const node = this.startNodeAt(startPos, startLoc);
  node.callee = expr;
  node.arguments = this.parseCallExpressionArguments(tt.parenR, false);
  node.safe = true;
  return this.finishNode(node, "CallExpression");
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
  if (!noCalls && this.match(tt.parenL) && this.state.pos === (questionPos + 1)) {
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
  return this.parseExistential(lhs, startPos, startLoc);
};

// Convert an existential to an optional flow parameter.
// Resolves grammar ambiguity in arrow function arg lists.
pp.existentialToParameter = function(node) {
  node.argument.optional = true;
  return node.argument;
};

pp.parseMatchStatement = function(node) {
  return this.parseMatch(node);
};

pp.parseMatchExpression = function() {
  return this.parseMatch(this.startNode(), true);
};

pp.parseMatch = function (node, isExpression) {
  this.expect(tt._match);
  node.discriminant = this.parseParenExpression();

  let isEnd;
  if (this.match(tt.colon)) {
    const indentLevel = this.state.indentLevel;
    this.next();
    isEnd = () => this.state.indentLevel <= indentLevel || this.match(tt.eof);
  } else {
    this.expect(tt.braceL);
    isEnd = () => this.eat(tt.braceR);
  }

  node.cases = [];
  let hasUsedElse = false;
  while (!isEnd()) {
    if (hasUsedElse) {
      this.unexpected(null, "`else` must be last case.");
    }

    const matchCase = this.parseMatchCase();
    if (matchCase.test && matchCase.test.type === "MatchElse") {
      hasUsedElse = true;
    }
    node.cases.push(matchCase);
  }

  return this.finishNode(node, isExpression ? "MatchExpression" : "MatchStatement");
};

pp.parseMatchCaseConsequent = function(matchNode) {
  // c/p parseIf
  if (this.match(tt.braceL)) {
    matchNode.consequent = this.parseBlock(false, true);
  } else {
    matchNode.consequent = this.parseWhiteBlock(true);
  }
};

pp.parseMatchCaseWithConsequent = function(matchNode) {
  // with (x) -> ..., with async, with ->
  if (this.match(tt.parenL) || this.match(tt.arrow) || this.isContextual("async")) {
    const consequent = this.parseMaybeAssign();
    if (consequent.type !== "ArrowFunctionExpression") {
      this.unexpected(consequent.start, tt.arrow);
    }
    matchNode.consequent = consequent;
    matchNode.functional = true;
    return;
  }

  // with <Identifier> -> ...
  // with <BindingAtom>: ...
  const node = this.startNode();
  const bindingAtom = this.parseBindingAtom();
  if (this.match(tt.arrow)) {
    matchNode.consequent = this.parseArrowExpression(node, bindingAtom ? [bindingAtom] : [], false);
    matchNode.functional = true;
    return;
  }

  matchNode.binding = bindingAtom;
  this.parseMatchCaseConsequent(matchNode);
};

pp.parseMatchCase = function () {
  const node = this.startNode();

  node.test = this.parseMatchCaseTest();

  const oldInMatchCaseConsequent = this.state.inMatchCaseConsequent;
  this.state.inMatchCaseConsequent = true;
  if (this.eat(tt._with)) {
    this.parseMatchCaseWithConsequent(node);
  } else {
    this.parseMatchCaseConsequent(node);
  }
  this.state.inMatchCaseConsequent = oldInMatchCaseConsequent;

  return this.finishNode(node, "MatchCase");
};

pp.parseMatchCaseTest = function () {
  // can't be nested so no need to read/restore old value
  this.state.inMatchCaseTest = true;

  this.expect(tt.bitwiseOR);
  if (this.isLineBreak()) this.unexpected(this.state.lastTokEnd, "Illegal newline.");

  let test;
  if (this.match(tt._else)) {
    const elseNode = this.startNode();
    this.next();
    test = this.finishNode(elseNode, "MatchElse");
  } else {
    test = this.parseExprOps();
  }

  this.state.inMatchCaseTest = false;
  return test;
};

pp.isBinaryTokenForMatchCase = function (tokenType) {
  return (
    tokenType.binop != null &&
    tokenType !== tt.logicalOR &&
    tokenType !== tt.logicalAND &&
    tokenType !== tt.bitwiseOR
  );
};

pp.isSubscriptTokenForMatchCase = function (tokenType) {
  return (
    tokenType === tt.dot ||
    tokenType === tt.elvis ||
    tokenType === tt.tilde ||
    tokenType === tt.bracketL ||
    tokenType === tt.question
  );
};

pp.allowMatchCasePlaceholder = function () {
  if (!this.state.inMatchCaseTest) {
    return false;
  }
  const cur = this.state.type;
  const prev = this.state.tokens[this.state.tokens.length - 1].type;

  // don't allow two binary tokens in a row to use placeholders, eg; `+ *`
  if (this.isBinaryTokenForMatchCase(cur)) {
    return !this.isBinaryTokenForMatchCase(prev);
  }
  // don't allow two subscripts in a row to use placeholders, eg; `..`
  if (this.isSubscriptTokenForMatchCase(cur)) {
    return !this.isSubscriptTokenForMatchCase(prev);
  }
  return false;
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
