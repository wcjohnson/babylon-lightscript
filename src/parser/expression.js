/* eslint max-len: 0 */

// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts — that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

import { types as tt } from "../tokenizer/types";
import Parser from "./index";
import { reservedWords } from "../util/identifier";

const pp = Parser.prototype;

// Check if property name clashes with already added.
// Object/class getters and setters are not allowed to clash —
// either with each other or with an init property — and in
// strict mode, init properties are also not allowed to be repeated.

pp.checkPropClash = function (prop, propHash) {
  if (prop.computed || prop.kind) return;

  const key = prop.key;
  // It is either an Identifier or a String/NumericLiteral
  const name = key.type === "Identifier" ? key.name : String(key.value);

  if (name === "__proto__") {
    if (propHash.proto) this.raise(key.start, "Redefinition of __proto__ property");
    propHash.proto = true;
  }
};

// Convenience method to parse an Expression only
pp.getExpression = function() {
  this.nextToken();
  const expr = this.parseExpression();
  if (!this.match(tt.eof)) {
    this.unexpected();
  }
  return expr;
};

// ### Expression parsing

// These nest, from the most general expression type at the top to
// 'atomic', nondivisible expression types at the bottom. Most of
// the functions will simply let the function (s) below them parse,
// and, *if* the syntactic construct they handle is present, wrap
// the AST node that the inner parser gave them in another node.

// Parse a full expression. The optional arguments are used to
// forbid the `in` operator (in for loops initialization expressions)
// and provide reference for storing '=' operator inside shorthand
// property assignment in contexts where both object expression
// and object pattern might appear (so it's possible to raise
// delayed syntax error at correct position).

pp.parseExpression = function (noIn, refShorthandDefaultPos) {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  const expr = this.parseMaybeAssign(noIn, refShorthandDefaultPos);
  if (this.match(tt.comma)) {
    const node = this.startNodeAt(startPos, startLoc);
    node.expressions = [expr];
    while (this.eat(tt.comma)) {
      node.expressions.push(this.parseMaybeAssign(noIn, refShorthandDefaultPos));
    }
    this.toReferencedList(node.expressions);
    return this.finishNode(node, "SequenceExpression");
  }
  return expr;
};

// Parse an assignment expression. This includes applications of
// operators like `+=`.

pp.parseMaybeAssign = function (noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos) {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;

  if (this.match(tt._yield) && this.state.inGenerator) {
    let left = this.parseYield();
    if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);
    return left;
  }

  let failOnShorthandAssign;
  if (refShorthandDefaultPos) {
    failOnShorthandAssign = false;
  } else {
    refShorthandDefaultPos = { start: 0 };
    failOnShorthandAssign = true;
  }

  if (this.match(tt.parenL) || this.match(tt.name)) {
    this.state.potentialArrowAt = this.state.start;
  }

  let leftStartsLine, isNowAssign;
  if (this.hasPlugin("lightscript")) {
    leftStartsLine = this.seemsLikeStatementStart();
    isNowAssign = this.eat(tt._now);
  }

  let left = this.parseMaybeConditional(noIn, refShorthandDefaultPos, refNeedsArrowPos);
  if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);

  // `varName: type = val`, with unwinding
  // (this is a likely source of ambiguities, bugs, etc, since whitespace-block colons and others may be interpreted as type decaration)
  let typeAnnotation;
  if (this.hasPlugin("lightscript") && this.hasPlugin("flow") && this.match(tt.colon) && !this.isFollowedByLineBreak() && leftStartsLine) {
    const state = this.state.clone();
    try {
      typeAnnotation = this.flowParseTypeAnnotation();
    } catch (err) {
      this.state = state;
    }

    // if it's not followed by `=` after all, unwind
    if (!(this.match(tt.eq) || this.match(tt.awaitArrow))) {
      this.state = state;
    }
  }

  if (this.state.type.isAssign) {
    const node = this.startNodeAt(startPos, startLoc);
    node.operator = this.state.value;

    // `or` -> `||` etc.
    if (this.hasPlugin("lightscript")) this.rewriteOperator(node);

    const isAwaitArrow = this.hasPlugin("lightscript") && this.match(tt.awaitArrow);
    if (isAwaitArrow && this.isLineBreak()) return left;

    node.left = this.match(tt.eq) || isAwaitArrow ? this.toAssignable(left, undefined, "assignment expression") : left;
    refShorthandDefaultPos.start = 0; // reset because shorthand default was used correctly

    this.checkLVal(left, undefined, undefined, "assignment expression");

    if (left.extra && left.extra.parenthesized) {
      let errorMsg;
      if (left.type === "ObjectPattern") {
        errorMsg = "`({a}) = 0` use `({a} = 0)`";
      } else if (left.type === "ArrayPattern") {
        errorMsg = "`([a]) = 0` use `([a] = 0)`";
      }
      if (errorMsg) {
        this.raise(left.start, `You're trying to assign to a parenthesized expression, eg. instead of ${errorMsg}`);
      }
    }

    if (typeAnnotation) {
      node.left.typeAnnotation = typeAnnotation;
      node.left.end = typeAnnotation.end;
      node.left.loc.end = typeAnnotation.loc.end;
    }

    if (isAwaitArrow) {
      node.right = this.parseAwaitArrow(node.left);
    } else {
      this.next();
      node.right = this.parseMaybeAssign(noIn);
    }

    if (this.hasPlugin("lightscript")) {
      node.isNowAssign = isNowAssign;
    }

    return this.finishNode(node, "AssignmentExpression");
  } else if (failOnShorthandAssign && refShorthandDefaultPos.start) {
    this.unexpected(refShorthandDefaultPos.start);
  }

  if (this.hasPlugin("lightscript") && isNowAssign) {
    if (left.type === "UpdateExpression" || noIn) {
      left.isNowAssign = true;
    } else {
      this.unexpected(left.start, "`now` can only be used with assignments and updates.");
    }
  }

  return left;
};

// Parse a ternary conditional (`?:`) operator.

pp.parseMaybeConditional = function (noIn, refShorthandDefaultPos, refNeedsArrowPos) {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  const expr = this.parseExprOps(noIn, refShorthandDefaultPos);
  if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;

  return this.parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos);
};

pp.parseConditional = function (expr, noIn, startPos, startLoc) {
  if (this.eat(tt.question)) {
    const node = this.startNodeAt(startPos, startLoc);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    this.expect(tt.colon);
    node.alternate = this.parseMaybeAssign(noIn);
    return this.finishNode(node, "ConditionalExpression");
  }
  return expr;
};

// Start the precedence parser.

pp.parseExprOps = function (noIn, refShorthandDefaultPos) {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  const expr = this.parseMaybeUnary(refShorthandDefaultPos);
  if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
    return expr;
  } else {
    return this.parseExprOp(expr, startPos, startLoc, -1, noIn);
  }
};

// Parse binary operators with the operator precedence parsing
// algorithm. `left` is the left-hand side of the operator.
// `minPrec` provides context that allows the function to stop and
// defer further parser to one of its callers when it encounters an
// operator that has a lower precedence than the set it is parsing.

pp.parseExprOp = function(left, leftStartPos, leftStartLoc, minPrec, noIn) {
  // correct ASI failures.
  if (this.hasPlugin("lightscript") && this.isLineBreak()) {

    // if it's a newline followed by a unary +/-, bail so it can be parsed separately.
    if (this.match(tt.plusMin) && !this.isNextCharWhitespace()) {
      return left;
    }
  }

  const prec = this.state.type.binop;
  if (prec != null && (!noIn || !this.match(tt._in))) {
    if (prec > minPrec) {
      const node = this.startNodeAt(leftStartPos, leftStartLoc);
      node.left = left;
      node.operator = this.state.value;

      // `or` -> `||` etc.
      if (this.hasPlugin("lightscript")) this.rewriteOperator(node);

      if (
        node.operator === "**" &&
        left.type === "UnaryExpression" &&
        left.extra &&
        !left.extra.parenthesizedArgument &&
        !left.extra.parenthesized
      ) {
        this.raise(left.argument.start, "Illegal expression. Wrap left hand side or entire exponentiation in parentheses.");
      }

      const op = this.state.type;
      this.next();

      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      node.right = this.parseExprOp(this.parseMaybeUnary(), startPos, startLoc, op.rightAssociative ? prec - 1 : prec, noIn);

      this.finishNode(node, (op === tt.logicalOR || op === tt.logicalAND) ? "LogicalExpression" : "BinaryExpression");
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
    }
  }
  return left;
};

// Parse unary operators, both prefix and postfix.

pp.parseMaybeUnary = function (refShorthandDefaultPos) {
  if (this.state.type.prefix) {
    if (this.hasPlugin("lightscript") && this.match(tt.plusMin)) {
      if (this.isNextCharWhitespace()) this.unexpected(null, "Unary +/- cannot be followed by a space in lightscript.");
    }

    const node = this.startNode();
    const update = this.match(tt.incDec);
    node.operator = this.state.value;

    // `not` -> `!` etc.
    if (this.hasPlugin("lightscript")) this.rewriteOperator(node);

    node.prefix = true;
    this.next();

    const argType = this.state.type;
    node.argument = this.parseMaybeUnary();

    this.addExtra(node, "parenthesizedArgument", argType === tt.parenL && (!node.argument.extra || !node.argument.extra.parenthesized));

    if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
      this.unexpected(refShorthandDefaultPos.start);
    }

    if (update) {
      this.checkLVal(node.argument, undefined, undefined, "prefix operation");
    } else if (this.state.strict && node.operator === "delete" && node.argument.type === "Identifier") {
      this.raise(node.start, "Deleting local variable in strict mode");
    }

    return this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  }

  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  let expr = this.parseExprSubscripts(refShorthandDefaultPos);
  if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;
  while (this.state.type.postfix && !this.canInsertSemicolon()) {
    const node = this.startNodeAt(startPos, startLoc);
    node.operator = this.state.value;
    node.prefix = false;
    node.argument = expr;
    this.checkLVal(expr, undefined, undefined, "postfix operation");
    this.next();
    expr = this.finishNode(node, "UpdateExpression");
  }
  return expr;
};

// Parse call, dot, and `[]`-subscript expressions.

pp.parseExprSubscripts = function (refShorthandDefaultPos) {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  const potentialArrowAt = this.state.potentialArrowAt;
  const expr = this.parseExprAtom(refShorthandDefaultPos);

  if (expr.type === "ArrowFunctionExpression" && expr.start === potentialArrowAt) {
    return expr;
  }

  if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
    return expr;
  }

  return this.parseSubscripts(expr, startPos, startLoc);
};

pp.parseSubscripts = function (base, startPos, startLoc, noCalls) {
  for (;;) {
    if (!noCalls && this.eat(tt.doubleColon)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.callee = this.parseNoCallExpr();
      return this.parseSubscripts(this.finishNode(node, "BindExpression"), startPos, startLoc, noCalls);
    } else if (this.eat(tt.dot)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.property = this.parseIdentifier(true);
      node.computed = false;
      base = this.finishNode(node, "MemberExpression");
    } else if (this.hasPlugin("lightscript") && this.match(tt.elvis)) {
      // `x?.y`
      const node = this.startNodeAt(startPos, startLoc);
      const op = this.state.value;
      this.next();
      node.object = base;
      if (op === "?.") {
        // arr?.0 -> arr?[0]
        if (this.match(tt.num)) {
          node.property = this.parseLiteral(this.state.value, "NumericLiteral");
          node.computed = true;
        } else {
          node.property = this.parseIdentifier(true);
          node.computed = false;
        }
      } else if (op === "?[") {
        node.property = this.parseExpression();
        node.computed = true;
        this.expect(tt.bracketR);
      } else {
        this.unexpected();
      }
      base = this.finishNode(node, "SafeMemberExpression");
    } else if (this.hasPlugin("lightscript") && !noCalls && this.eat(tt.tilde)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.left = base;
      // allow Identifier or MemberExpression, but not calls
      node.right = this.parseSubscripts(this.parseIdentifier(), this.state.start, this.state.startLoc, true);

      this.expect(tt.parenL);
      node.arguments = this.parseCallExpressionArguments(tt.parenR, false);
      base = this.finishNode(node, "TildeCallExpression");
    } else if (this.hasPlugin("lightscript") && this.isNumberStartingWithDot() && !this.isNonIndentedBreakFrom(startPos)) {
      // parses x.0, x.1, etc, as x[0], x[1], etc.
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.property = this.parseNumericLiteralMember();
      node.computed = true;
      base = this.finishNode(node, "MemberExpression");
    } else if (!(this.hasPlugin("lightscript") && this.isNonIndentedBreakFrom(startPos)) && this.eat(tt.bracketL)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.property = this.parseExpression();
      node.computed = true;
      this.expect(tt.bracketR);
      base = this.finishNode(node, "MemberExpression");
    } else if (!noCalls && this.match(tt.parenL) && !(this.hasPlugin("lightscript") && this.isLineBreak())) {
      const possibleAsync = this.state.potentialArrowAt === base.start && base.type === "Identifier" && base.name === "async" && !this.canInsertSemicolon();
      const possibleArrow = possibleAsync || this.hasPlugin("lightscript");
      const refShorthandDefaultPos = possibleArrow ? { start: 0 } : undefined;
      this.next();

      const node = this.startNodeAt(startPos, startLoc);
      node.callee = base;
      node.arguments = this.parseCallExpressionArguments(tt.parenR, possibleArrow, refShorthandDefaultPos);
      if (node.callee.type === "Import" && node.arguments.length !== 1) {
        this.raise(node.start, "import() requires exactly one argument");
      }
      base = this.finishNode(node, "CallExpression");

      if (possibleAsync && this.shouldParseAsyncArrow()) {
        return this.parseAsyncArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
      } else if (this.hasPlugin("lightscript") && this.shouldParseAsyncArrow()) {

        // could be a function call followed by a colon-block, eg `if fn(): blah`
        // or an annotated NamedArrowExpression, eg `fn(): blah ->`
        // Disambiguating is hard, especially with good error messages...
        // TODO: relentlessly test edge cases.
        // This is one of the most likely sources of bugs I've encountered yet.
        if (this.match(tt.colon)) {
          const state = this.state.clone();
          try {
            return this.parseNamedArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
          } catch (err) {
            if (this.match(tt.arrow)) throw err;
            this.state = state;
          }
        } else {
          return this.parseNamedArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
        }
      }
      if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
        this.unexpected(refShorthandDefaultPos.start);
      }
      this.toReferencedList(node.arguments);
    } else if (this.hasPlugin("lightscript") && this.hasPlugin("flow") && this.isRelational("<")) {
      // `fn<T>() ->`, c/p of the above, but for `<`
      const node = this.startNodeAt(startPos, startLoc), state = this.state.clone();
      node.callee = base;
      try {
        node.typeParameters = this.flowParseTypeParameterDeclaration();
        this.expect(tt.parenL);
      } catch (err) {
        this.state = state;
        return base;
      }
      node.arguments = this.parseCallExpressionArguments(tt.parenR, true, { start: 0 });
      if (!this.shouldParseArrow()) this.unexpected();
      return this.parseNamedArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
    } else if (this.match(tt.backQuote) && !(this.hasPlugin("lightscript") && this.isLineBreak())) {
      const node = this.startNodeAt(startPos, startLoc);
      node.tag = base;
      node.quasi = this.parseTemplate();
      base = this.finishNode(node, "TaggedTemplateExpression");
    } else {
      return base;
    }
  }
};

// last parameter (refShorthandDefaultPos) added for lightscript,
// but should be contributed upstream because it fixes a minor bug in babylon:
// `async({ foo = 1 })` parses as a function call but should raise an error.
pp.parseCallExpressionArguments = function (close, possibleAsyncArrow, refShorthandDefaultPos) {
  const elts = [];
  let innerParenStart;
  let first = true;

  while (!this.eat(close)) {
    if (first) {
      first = false;
    } else {
      if (this.hasPlugin("lightscript")) {
        this.expectCommaOrLineBreak();
      } else {
        this.expect(tt.comma);
      }
      if (this.eat(close)) break;
    }

    // we need to make sure that if this is an async arrow functions, that we don't allow inner parens inside the params
    if (this.match(tt.parenL) && !innerParenStart) {
      innerParenStart = this.state.start;
    }

    elts.push(this.parseExprListItem(false, refShorthandDefaultPos, refShorthandDefaultPos));
  }

  // we found an async arrow function so let's not allow any inner parens
  if (possibleAsyncArrow && innerParenStart && this.shouldParseAsyncArrow()) {
    this.unexpected();
  }

  return elts;
};

pp.shouldParseAsyncArrow = function () {
  if (this.hasPlugin("lightscript") && this.isLineBreak()) {
    return false;
  }
  return this.match(tt.arrow);
};

pp.parseAsyncArrowFromCallExpression = function (node, call) {
  this.check(tt.arrow);
  return this.parseArrowExpression(node, call.arguments, true);
};

// Parse a no-call expression (like argument of `new` or `::` operators).

pp.parseNoCallExpr = function () {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  return this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
};

// Parse an atomic expression — either a single token that is an
// expression, an expression started by a keyword like `function` or
// `new`, or an expression wrapped in punctuation like `()`, `[]`,
// or `{}`.

pp.parseExprAtom = function (refShorthandDefaultPos) {
  const canBeArrow = this.state.potentialArrowAt === this.state.start;
  let node;

  switch (this.state.type) {
    case tt._super:
      if (!this.state.inMethod && !this.options.allowSuperOutsideMethod) {
        this.raise(this.state.start, "'super' outside of function or class");
      }

      node = this.startNode();
      this.next();
      if (!this.match(tt.parenL) && !this.match(tt.bracketL) && !this.match(tt.dot)) {
        this.unexpected();
      }
      if (this.match(tt.parenL) && this.state.inMethod !== "constructor" && !this.options.allowSuperOutsideMethod) {
        this.raise(node.start, "super() outside of class constructor");
      }
      return this.finishNode(node, "Super");

    case tt._import:
      if (!this.hasPlugin("dynamicImport")) this.unexpected();

      node = this.startNode();
      this.next();
      if (!this.match(tt.parenL)) {
        this.unexpected(null, tt.parenL);
      }
      return this.finishNode(node, "Import");

    case tt._this:
      node = this.startNode();
      this.next();
      return this.finishNode(node, "ThisExpression");

    case tt._yield:
      if (this.state.inGenerator) this.unexpected();

    case tt.name:
      node = this.startNode();
      const allowAwait = this.state.value === "await" && this.state.inAsync;
      const allowYield = this.shouldAllowYieldIdentifier();
      const id = this.parseIdentifier(allowAwait || allowYield);

      if (id.name === "await") {
        if (this.state.inAsync || this.inModule) {
          return this.parseAwait(node);
        }
      } else if (id.name === "async" && this.match(tt._function) && !this.canInsertSemicolon()) {
        this.next();
        return this.parseFunction(node, false, false, true);
      } else if (canBeArrow && id.name === "async" && this.match(tt.name)) {
        const params = [this.parseIdentifier()];
        this.check(tt.arrow);
        // let foo = bar => {};
        return this.parseArrowExpression(node, params, true);
      }

      if (canBeArrow && !this.canInsertSemicolon() && this.match(tt.arrow)) {
        return this.parseArrowExpression(node, [id]);
      }

      return id;

    case tt._do:
      if (this.hasPlugin("doExpressions")) {
        const node = this.startNode();
        this.next();
        const oldInFunction = this.state.inFunction;
        const oldLabels = this.state.labels;
        this.state.labels = [];
        this.state.inFunction = false;
        node.body = this.parseBlock(false, true);
        this.state.inFunction = oldInFunction;
        this.state.labels = oldLabels;
        return this.finishNode(node, "DoExpression");
      }

    case tt.regexp:
      const value = this.state.value;
      node = this.parseLiteral(value.value, "RegExpLiteral");
      node.pattern = value.pattern;
      node.flags = value.flags;
      return node;

    case tt.num:
      return this.parseLiteral(this.state.value, "NumericLiteral");

    case tt.string:
      return this.parseLiteral(this.state.value, "StringLiteral");

    case tt._null:
      node = this.startNode();
      this.next();
      return this.finishNode(node, "NullLiteral");

    case tt._true: case tt._false:
      node = this.startNode();
      node.value = this.match(tt._true);
      this.next();
      return this.finishNode(node, "BooleanLiteral");

    case tt.parenL:
      return this.parseParenAndDistinguishExpression(null, null, canBeArrow);

    case tt.bracketL:
      node = this.startNode();
      this.next();
      if (this.hasPlugin("lightscript") && this.match(tt._for)) {
        return this.parseArrayComprehension(node);
      }
      node.elements = this.parseExprList(tt.bracketR, true, refShorthandDefaultPos);
      this.toReferencedList(node.elements);
      return this.finishNode(node, "ArrayExpression");

    case tt.braceL:
      return this.parseObj(false, refShorthandDefaultPos);

    case tt._function:
      return this.parseFunctionExpression();

    case tt.at:
      this.parseDecorators();

    case tt._class:
      node = this.startNode();
      this.takeDecorators(node);
      return this.parseClass(node, false);

    case tt._new:
      return this.parseNew();

    case tt.backQuote:
      return this.parseTemplate();

    case tt.doubleColon:
      node = this.startNode();
      this.next();
      node.object = null;
      const callee = node.callee = this.parseNoCallExpr();
      if (callee.type === "MemberExpression") {
        return this.finishNode(node, "BindExpression");
      } else {
        this.raise(callee.start, "Binding should be performed on object property.");
      }

    case tt._if:
      if (this.hasPlugin("lightscript")) {
        node = this.startNode();
        return this.parseIfExpression(node);
      }

    case tt.arrow:
      if (this.hasPlugin("lightscript")) {
        node = this.startNode();
        return this.parseArrowExpression(node, []);
      }

    case tt.awaitArrow:
      if (this.hasPlugin("lightscript")) {
        node = this.startNode();
        const isSafe = this.state.value === "<!-";
        this.next();
        return isSafe ? this.parseSafeAwait(node) : this.parseAwait(node);
      }

    case tt._else: case tt._elif:
      if (this.hasPlugin("lightscript")) {
        this.unexpected(null, "Unmatched `else` (must match indentation of the line with `if`).");
      }

    default:
      this.unexpected();
  }
};

pp.parseFunctionExpression = function () {
  const node = this.startNode();
  const meta = this.parseIdentifier(true);
  if (this.state.inGenerator && this.eat(tt.dot) && this.hasPlugin("functionSent")) {
    return this.parseMetaProperty(node, meta, "sent");
  } else {
    return this.parseFunction(node, false);
  }
};

pp.parseMetaProperty = function (node, meta, propertyName) {
  node.meta = meta;
  node.property = this.parseIdentifier(true);

  if (node.property.name !== propertyName) {
    this.raise(node.property.start, `The only valid meta property for new is ${meta.name}.${propertyName}`);
  }

  return this.finishNode(node, "MetaProperty");
};

pp.parseLiteral = function (value, type, startPos, startLoc) {
  startPos = startPos || this.state.start;
  startLoc = startLoc || this.state.startLoc;

  const node = this.startNodeAt(startPos, startLoc);
  this.addExtra(node, "rawValue", value);
  this.addExtra(node, "raw", this.input.slice(startPos, this.state.end));
  node.value = value;
  this.next();
  return this.finishNode(node, type);
};

pp.parseParenExpression = function () {
  this.expect(tt.parenL);
  const val = this.parseExpression();
  this.expect(tt.parenR);
  return val;
};

pp.parseParenAndDistinguishExpression = function (startPos, startLoc, canBeArrow) {
  startPos = startPos || this.state.start;
  startLoc = startLoc || this.state.startLoc;

  let val;
  this.expect(tt.parenL);

  const innerStartPos = this.state.start;
  const innerStartLoc = this.state.startLoc;
  const exprList = [];
  const refShorthandDefaultPos = { start: 0 };
  const refNeedsArrowPos = { start: 0 };
  let first = true;
  let spreadStart;
  let optionalCommaStart;

  while (!this.match(tt.parenR)) {
    if (first) {
      first = false;
    } else {
      this.expect(tt.comma, refNeedsArrowPos.start || null);
      if (this.match(tt.parenR)) {
        optionalCommaStart = this.state.start;
        break;
      }
    }

    if (this.match(tt.ellipsis)) {
      const spreadNodeStartPos = this.state.start;
      const spreadNodeStartLoc = this.state.startLoc;
      spreadStart = this.state.start;
      exprList.push(this.parseParenItem(this.parseRest(), spreadNodeStartPos, spreadNodeStartLoc));
      break;
    } else {
      exprList.push(this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos));
    }
  }

  const innerEndPos = this.state.start;
  const innerEndLoc = this.state.startLoc;
  this.expect(tt.parenR);

  let arrowNode = this.startNodeAt(startPos, startLoc);
  if (canBeArrow && this.shouldParseArrow() && (arrowNode = this.parseArrow(arrowNode))) {
    for (const param of exprList) {
      if (param.extra && param.extra.parenthesized) this.unexpected(param.extra.parenStart);
    }

    return this.parseArrowExpression(arrowNode, exprList);
  }

  if (!exprList.length) {
    this.unexpected(this.state.lastTokStart);
  }
  if (optionalCommaStart) this.unexpected(optionalCommaStart);
  if (spreadStart) this.unexpected(spreadStart);
  if (refShorthandDefaultPos.start) this.unexpected(refShorthandDefaultPos.start);
  if (refNeedsArrowPos.start) this.unexpected(refNeedsArrowPos.start);

  if (exprList.length > 1) {
    val = this.startNodeAt(innerStartPos, innerStartLoc);
    val.expressions = exprList;
    this.toReferencedList(val.expressions);
    this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
  } else {
    val = exprList[0];
  }


  this.addExtra(val, "parenthesized", true);
  this.addExtra(val, "parenStart", startPos);

  return val;
};

pp.shouldParseArrow = function () {
  return !this.canInsertSemicolon();
};

pp.parseArrow = function (node) {
  if (this.match(tt.arrow)) {
    return node;
  }
};

pp.parseParenItem = function (node) {
  return node;
};

// New's precedence is slightly tricky. It must allow its argument
// to be a `[]` or dot subscript expression, but not a call — at
// least, not without wrapping it in parentheses. Thus, it uses the

pp.parseNew = function () {
  const node = this.startNode();
  const meta = this.parseIdentifier(true);

  if (this.eat(tt.dot)) {
    return this.parseMetaProperty(node, meta, "target");
  }

  node.callee = this.parseNoCallExpr();

  // Lightscript ASI: don't parse as arg list if on a different line
  if (!(this.hasPlugin("lightscript") && this.isLineBreak()) && this.eat(tt.parenL)) {
    node.arguments = this.parseExprList(tt.parenR);
    this.toReferencedList(node.arguments);
  } else {
    node.arguments = [];
  }

  return this.finishNode(node, "NewExpression");
};

// Parse template expression.

pp.parseTemplateElement = function () {
  const elem = this.startNode();
  elem.value = {
    raw: this.input.slice(this.state.start, this.state.end).replace(/\r\n?/g, "\n"),
    cooked: this.state.value
  };
  this.next();
  elem.tail = this.match(tt.backQuote);
  return this.finishNode(elem, "TemplateElement");
};

pp.parseTemplate = function () {
  const node = this.startNode();
  this.next();
  node.expressions = [];
  let curElt = this.parseTemplateElement();
  node.quasis = [curElt];
  while (!curElt.tail) {
    this.expect(tt.dollarBraceL);
    node.expressions.push(this.parseExpression());
    this.expect(tt.braceR);
    node.quasis.push(curElt = this.parseTemplateElement());
  }
  this.next();
  return this.finishNode(node, "TemplateLiteral");
};

// Parse an object literal or binding pattern.

pp.parseObj = function (isPattern, refShorthandDefaultPos) {
  let decorators = [];
  const propHash = Object.create(null);
  let first = true;
  const node = this.startNode();

  node.properties = [];
  this.next();

  // `for` keyword begins an object comprehension.
  if (this.hasPlugin("lightscript") && this.match(tt._for)) {
    // ...however, `{ for: x }` is a legal JS object.
    if (this.lookahead().type !== tt.colon) {
      return this.parseObjectComprehension(node);
    }
  }

  let firstRestLocation = null;

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

    while (this.match(tt.at)) {
      decorators.push(this.parseDecorator());
    }

    let prop = this.startNode(), isGenerator = false, isAsync = false, startPos, startLoc;
    if (decorators.length) {
      prop.decorators = decorators;
      decorators = [];
    }

    if (this.hasPlugin("objectRestSpread") && this.match(tt.ellipsis)) {
      prop = this.parseSpread(isPattern ? { start: 0 } : undefined);
      prop.type = isPattern ? "RestProperty" : "SpreadProperty";
      if (isPattern) this.toAssignable(prop.argument, true, "object pattern");
      node.properties.push(prop);
      if (isPattern) {
        const position = this.state.start;
        if (firstRestLocation !== null) {
          this.unexpected(firstRestLocation, "Cannot have multiple rest elements when destructuring");
        } else if (this.eat(tt.braceR)) {
          break;
        } else if (this.match(tt.comma) && this.lookahead().type === tt.braceR) {
          // TODO: temporary rollback
          // this.unexpected(position, "A trailing comma is not permitted after the rest element");
          continue;
        } else {
          firstRestLocation = position;
          continue;
        }
      } else {
        continue;
      }
    }

    prop.method = false;
    prop.shorthand = false;

    if (isPattern || refShorthandDefaultPos) {
      startPos = this.state.start;
      startLoc = this.state.startLoc;
    }

    if (!isPattern) {
      isGenerator = this.eat(tt.star);
    }

    if (!isPattern && this.isContextual("async")) {
      if (isGenerator) this.unexpected();

      const asyncId = this.parseIdentifier();
      if (this.match(tt.colon) || this.match(tt.parenL) || this.match(tt.braceR) || this.match(tt.eq) || this.match(tt.comma) || (this.hasPlugin("lightscript") && this.isLineBreak())) {
        prop.key = asyncId;
        prop.computed = false;
      } else {
        isAsync = true;
        if (this.hasPlugin("asyncGenerators")) isGenerator = this.eat(tt.star);
        this.parsePropertyName(prop);
      }
    } else {
      this.parsePropertyName(prop);
    }

    this.parseObjPropValue(prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos);
    this.checkPropClash(prop, propHash);

    if (prop.shorthand) {
      this.addExtra(prop, "shorthand", true);
    }

    node.properties.push(prop);
  }

  if (firstRestLocation !== null) {
    this.unexpected(firstRestLocation, "The rest element has to be the last element when destructuring");
  }

  if (decorators.length) {
    this.raise(this.state.start, "You have trailing decorators with no property");
  }

  return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
};

pp.isGetterOrSetterMethod = function (prop, isPattern) {
  return !isPattern &&
    !prop.computed &&
    prop.key.type === "Identifier" &&
    (prop.key.name === "get" || prop.key.name === "set") &&
    !(this.hasPlugin("lightscript") && this.isLineBreak()) &&
    (
      this.match(tt.string) || // get "string"() {}
      this.match(tt.num) || // get 1() {}
      this.match(tt.bracketL) || // get ["string"]() {}
      this.match(tt.name) || // get foo() {}
      this.state.type.keyword // get debugger() {}
    );
};

// get methods aren't allowed to have any parameters
// set methods must have exactly 1 parameter
pp.checkGetterSetterParamCount = function (method) {
  const paramCount = method.kind === "get" ? 0 : 1;
  if (method.params.length !== paramCount) {
    const start = method.start;
    if (method.kind === "get") {
      this.raise(start, "getter should have no params");
    } else {
      this.raise(start, "setter should have exactly one param");
    }
  }
};

pp.parseObjectMethod = function (prop, isGenerator, isAsync, isPattern) {
  if (isAsync || isGenerator || this.match(tt.parenL)) {
    if (isPattern) this.unexpected();
    prop.kind = "method";
    prop.method = true;
    this.parseMethod(prop, isGenerator, isAsync);

    return this.finishNode(prop, "ObjectMethod");
  }

  if (this.isGetterOrSetterMethod(prop, isPattern)) {
    if (isGenerator || isAsync) this.unexpected();
    prop.kind = prop.key.name;
    this.parsePropertyName(prop);
    this.parseMethod(prop);
    this.checkGetterSetterParamCount(prop);

    return this.finishNode(prop, "ObjectMethod");
  }
};

pp.parseObjectProperty = function (prop, startPos, startLoc, isPattern, refShorthandDefaultPos) {
  if (this.eat(tt.colon)) {
    prop.value = isPattern ? this.parseMaybeDefault(this.state.start, this.state.startLoc) : this.parseMaybeAssign(false, refShorthandDefaultPos);

    return this.finishNode(prop, "ObjectProperty");
  }

  if (!prop.computed && prop.key.type === "Identifier") {
    if (isPattern) {
      this.checkReservedWord(prop.key.name, prop.key.start, true, true);
      prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
    } else if (this.match(tt.eq) && refShorthandDefaultPos) {
      if (!refShorthandDefaultPos.start) {
        refShorthandDefaultPos.start = this.state.start;
      }
      prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
    } else {
      prop.value = prop.key.__clone();
    }
    prop.shorthand = true;

    return this.finishNode(prop, "ObjectProperty");
  }
};

pp.parseObjPropValue = function (prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos) {
  const node =
    this.parseObjectMethod(prop, isGenerator, isAsync, isPattern) ||
    this.parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos);

  if (!node) this.unexpected();

  return node;
};

pp.parsePropertyName = function (prop) {
  if (this.eat(tt.bracketL)) {
    prop.computed = true;
    prop.key = this.parseMaybeAssign();
    this.expect(tt.bracketR);
  } else {
    prop.computed = false;
    const oldInPropertyName = this.state.inPropertyName;
    this.state.inPropertyName = true;
    prop.key = (this.match(tt.num) || this.match(tt.string)) ? this.parseExprAtom() : this.parseIdentifier(true);
    this.state.inPropertyName = oldInPropertyName;
  }
  return prop.key;
};

// Initialize empty function node.

pp.initFunction = function (node, isAsync) {
  node.id = null;
  node.generator = false;
  node.expression = false;
  node.async = !!isAsync;
};

// Parse object or class method.

pp.parseMethod = function (node, isGenerator, isAsync) {
  const oldInMethod = this.state.inMethod;
  this.state.inMethod = node.kind || true;
  this.initFunction(node, isAsync);
  this.expect(tt.parenL);
  node.params = this.parseBindingList(tt.parenR);
  node.generator = !!isGenerator;

  if (this.hasPlugin("lightscript") && this.match(tt.colon)) {
    const oldNoAnonFunctionType = this.state.noAnonFunctionType;
    this.state.noAnonFunctionType = true;
    node.returnType = this.flowParseTypeAnnotation();
    this.state.noAnonFunctionType = oldNoAnonFunctionType;
  }

  if (this.hasPlugin("lightscript") && this.match(tt.arrow)) {
    this.parseArrowType(node);

    if (node.kind === "get" || node.kind === "set") {
      this.checkGetterSetterParamCount(node);
    }

    this.parseArrowFunctionBody(node);
  } else {
    this.parseFunctionBody(node);
  }

  this.state.inMethod = oldInMethod;
  return node;
};

// Parse arrow function expression with given parameters.

pp.parseArrowExpression = function (node, params, isAsync) {
  this.initFunction(node, isAsync);
  node.params = this.toAssignableList(params, true, "arrow function parameters");

  if (this.hasPlugin("lightscript")) {
    this.check(tt.arrow);
    this.parseArrowType(node);
    this.parseArrowFunctionBody(node);
  } else {
    this.expect(tt.arrow);
    this.parseFunctionBody(node, true);
  }
  return this.finishNode(node, "ArrowFunctionExpression");
};

pp.isStrictBody = function (node, isExpression) {
  if (!isExpression && node.body.directives.length) {
    for (const directive of (node.body.directives: Array<Object>)) {
      if (directive.value.value === "use strict") {
        return true;
      }
    }
  }

  return false;
};

// Parse function body and check parameters.
pp.parseFunctionBody = function (node, allowExpression) {
  const isExpression = allowExpression && !this.match(tt.braceL);

  const oldInAsync = this.state.inAsync;
  this.state.inAsync = node.async;
  if (isExpression) {
    node.body = this.parseMaybeAssign();
    node.expression = true;
  } else {
    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    const oldInFunc = this.state.inFunction;
    const oldInGen = this.state.inGenerator;
    const oldLabels = this.state.labels;
    this.state.inFunction = true; this.state.inGenerator = node.generator; this.state.labels = [];
    node.body = this.parseBlock(true);
    node.expression = false;
    this.state.inFunction = oldInFunc; this.state.inGenerator = oldInGen; this.state.labels = oldLabels;
  }
  this.state.inAsync = oldInAsync;

  this.validateFunctionBody(node, allowExpression);
};

pp.validateFunctionBody = function (node, allowExpression) {
  const isExpression = node.expression;

  // If this is a strict mode function, verify that argument names
  // are not repeated, and it does not try to bind the words `eval`
  // or `arguments`.
  const isStrict = this.isStrictBody(node, isExpression);
  // Also check when allowExpression === true for arrow functions
  const checkLVal = this.state.strict || allowExpression || isStrict;

  if (isStrict && node.id && node.id.type === "Identifier" && node.id.name === "yield") {
    this.raise(node.id.start, "Binding yield in strict mode");
  }

  if (checkLVal) {
    const nameHash = Object.create(null);
    const oldStrict = this.state.strict;
    if (isStrict) this.state.strict = true;
    if (node.id) {
      this.checkLVal(node.id, true, undefined, "function name");
    }
    for (const param of (node.params: Array<Object>)) {
      if (isStrict && param.type !== "Identifier") {
        this.raise(param.start, "Non-simple parameter in strict mode");
      }
      this.checkLVal(param, true, nameHash, "function parameter list");
    }
    this.state.strict = oldStrict;
  }
};

// Parses a comma-separated list of expressions, and returns them as
// an array. `close` is the token type that ends the list, and
// `allowEmpty` can be turned on to allow subsequent commas with
// nothing in between them to be parsed as `null` (which is needed
// for array literals).

pp.parseExprList = function (close, allowEmpty, refShorthandDefaultPos) {
  const elts = [];
  let first = true;

  while (!this.eat(close)) {
    if (first) {
      first = false;
    } else {
      if (this.hasPlugin("lightscript")) {
        this.expectCommaOrLineBreak();
      } else {
        this.expect(tt.comma);
      }
      if (this.eat(close)) break;
    }

    elts.push(this.parseExprListItem(allowEmpty, refShorthandDefaultPos));
  }
  return elts;
};

pp.parseExprListItem = function (allowEmpty, refShorthandDefaultPos, refNeedsArrowPos) {
  let elt;
  if (allowEmpty && this.match(tt.comma)) {
    elt = null;
  } else if (this.match(tt.ellipsis)) {
    elt = this.parseSpread(refShorthandDefaultPos);
  } else {
    elt = this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos);
  }
  return elt;
};

// Parse the next token as an identifier. If `liberal` is true (used
// when parsing properties), it will also convert keywords into
// identifiers.

pp.parseIdentifier = function (liberal) {
  const node = this.startNode();
  if (!liberal) {
    this.checkReservedWord(this.state.value, this.state.start, !!this.state.type.keyword, false);
  }

  if (this.match(tt.name)) {
    node.name = this.state.value;
  } else if (this.state.type.keyword) {
    node.name = this.state.type.keyword;
  } else {
    this.unexpected();
  }

  if (!liberal && node.name === "await" && this.state.inAsync) {
    this.raise(node.start, "invalid use of await inside of an async function");
  }

  node.loc.identifierName = node.name;

  this.next();
  return this.finishNode(node, "Identifier");
};

pp.checkReservedWord = function (word, startLoc, checkKeywords, isBinding) {
  if (this.isReservedWord(word) || (checkKeywords && this.isKeyword(word))) {
    this.raise(startLoc, word + " is a reserved word");
  }

  if (this.state.strict && (reservedWords.strict(word) || (isBinding && reservedWords.strictBind(word)))) {
    this.raise(startLoc, word + " is a reserved word in strict mode");
  }
};

// Parses await expression inside async function.

pp.parseAwait = function (node) {
  // istanbul ignore next: this condition is checked at the call site so won't be hit here
  if (!this.state.inAsync) {
    this.unexpected();
  }
  if (this.match(tt.star)) {
    this.raise(node.start, "await* has been removed from the async functions proposal. Use Promise.all() instead.");
  }
  node.argument = this.parseMaybeUnary();
  return this.finishNode(node, "AwaitExpression");
};

// Parses yield expression inside generator.

pp.parseYield = function () {
  const node = this.startNode();
  this.next();
  if (
    this.match(tt.semi) ||
    this.canInsertSemicolon() ||
    (!this.match(tt.star) && !this.state.type.startsExpr)
  ) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = this.eat(tt.star);
    node.argument = this.parseMaybeAssign();
  }
  return this.finishNode(node, "YieldExpression");
};
