import fromCodePoint from "./fromCodePoint";

import XHTMLEntities from "./xhtml";
import { TokenType, types as tt } from "../../tokenizer/types";
import { TokContext, types as tc } from "../../tokenizer/context";
import Parser from "../../parser";
import { isIdentifierChar, isIdentifierStart } from "../../util/identifier";
import { isNewLine } from "../../util/whitespace";

const HEX_NUMBER = /^[\da-fA-F]+$/;
const DECIMAL_NUMBER = /^\d+$/;

tc.j_oTag = new TokContext("<tag", false);
tc.j_cTag = new TokContext("</tag", false);
tc.j_expr = new TokContext("<tag>...</tag>", true, true);

tt.jsxName = new TokenType("jsxName");
tt.jsxText = new TokenType("jsxText", { beforeExpr: true });
tt.jsxTagStart = new TokenType("jsxTagStart", { startsExpr: true });
tt.jsxTagEnd = new TokenType("jsxTagEnd");

tt.jsxTagStart.updateContext = function() {
  this.state.context.push(tc.j_expr); // treat as beginning of JSX expression
  this.state.context.push(tc.j_oTag); // start opening tag context
  this.state.exprAllowed = false;
};

tt.jsxTagEnd.updateContext = function(prevType) {
  const out = this.state.context.pop();
  if (out === tc.j_oTag && prevType === tt.slash || out === tc.j_cTag) {
    this.state.context.pop();
    this.state.exprAllowed = this.curContext() === tc.j_expr;
  } else {
    this.state.exprAllowed = true;
  }
};

const pp = Parser.prototype;

// Reads inline JSX contents token.

pp.jsxReadToken = function() {
  let out = "";
  let chunkStart = this.state.pos;
  for (;;) {
    if (this.state.pos >= this.input.length) {
      this.raise(this.state.start, "Unterminated JSX contents");
    }

    const ch = this.input.charCodeAt(this.state.pos);

    switch (ch) {
      case 60: // "<"
      case 123: // "{"
        if (this.state.pos === this.state.start) {
          if (ch === 60 && this.state.exprAllowed) {
            ++this.state.pos;
            return this.finishToken(tt.jsxTagStart);
          }
          return this.getTokenFromCode(ch);
        }
        out += this.input.slice(chunkStart, this.state.pos);
        return this.finishToken(tt.jsxText, out);

      case 38: // "&"
        out += this.input.slice(chunkStart, this.state.pos);
        out += this.jsxReadEntity();
        chunkStart = this.state.pos;
        break;

      default:
        if (isNewLine(ch)) {
          out += this.input.slice(chunkStart, this.state.pos);
          out += this.jsxReadNewLine(true);
          chunkStart = this.state.pos;
        } else {
          ++this.state.pos;
        }
    }
  }
};

pp.jsxReadNewLine = function(normalizeCRLF) {
  const ch = this.input.charCodeAt(this.state.pos);
  let out;
  ++this.state.pos;
  if (ch === 13 && this.input.charCodeAt(this.state.pos) === 10) {
    ++this.state.pos;
    out = normalizeCRLF ? "\n" : "\r\n";
  } else {
    out = String.fromCharCode(ch);
  }
  ++this.state.curLine;
  this.state.lineStart = this.state.pos;

  // DUP in `Tokenizer.skipSpace()`
  if (this.hasPlugin("lightscript")) {
    this.state.indentLevel = 0;
    while (this.input.charCodeAt(this.state.pos) === 32) {
      if (this.input.charCodeAt(this.state.pos + 1) === 32) {
        ++this.state.pos;
        ++this.state.pos;
        ++this.state.indentLevel;
        out += "  ";
      } else {
        break;
      }
    }
  }

  return out;
};

pp.jsxReadString = function(quote) {
  let out = "";
  let chunkStart = ++this.state.pos;
  for (;;) {
    if (this.state.pos >= this.input.length) {
      this.raise(this.state.start, "Unterminated string constant");
    }

    const ch = this.input.charCodeAt(this.state.pos);
    if (ch === quote) break;
    if (ch === 38) { // "&"
      out += this.input.slice(chunkStart, this.state.pos);
      out += this.jsxReadEntity();
      chunkStart = this.state.pos;
    } else if (isNewLine(ch)) {
      out += this.input.slice(chunkStart, this.state.pos);
      out += this.jsxReadNewLine(false);
      chunkStart = this.state.pos;
    } else {
      ++this.state.pos;
    }
  }
  out += this.input.slice(chunkStart, this.state.pos++);
  return this.finishToken(tt.string, out);
};

pp.jsxReadEntity = function() {
  let str = "";
  let count = 0;
  let entity;
  let ch = this.input[this.state.pos];

  const startPos = ++this.state.pos;
  while (this.state.pos < this.input.length && count++ < 10) {
    ch = this.input[this.state.pos++];
    if (ch === ";") {
      if (str[0] === "#") {
        if (str[1] === "x") {
          str = str.substr(2);
          if (HEX_NUMBER.test(str))
            entity = fromCodePoint(parseInt(str, 16));
        } else {
          str = str.substr(1);
          if (DECIMAL_NUMBER.test(str))
            entity = fromCodePoint(parseInt(str, 10));
        }
      } else {
        entity = XHTMLEntities[str];
      }
      break;
    }
    str += ch;
  }
  if (!entity) {
    this.state.pos = startPos;
    return "&";
  }
  return entity;
};


// Read a JSX identifier (valid tag or attribute name).
//
// Optimized version since JSX identifiers can"t contain
// escape characters and so can be read as single slice.
// Also assumes that first character was already checked
// by isIdentifierStart in readToken.

pp.jsxReadWord = function() {
  let ch;
  const start = this.state.pos;
  do {
    ch = this.input.charCodeAt(++this.state.pos);
  } while (isIdentifierChar(ch) || ch === 45); // "-"
  return this.finishToken(tt.jsxName, this.input.slice(start, this.state.pos));
};

// Transforms JSX element name to string.

function getQualifiedJSXName(object) {
  if (object.type === "JSXIdentifier") {
    return object.name;
  }

  if (object.type === "JSXNamespacedName") {
    return object.namespace.name + ":" + object.name.name;
  }

  if (object.type === "JSXMemberExpression") {
    return getQualifiedJSXName(object.object) + "." + getQualifiedJSXName(object.property);
  }
}

// Parse next token as JSX identifier

pp.jsxParseIdentifier = function() {
  const node = this.startNode();
  if (this.match(tt.jsxName)) {
    node.name = this.state.value;
  } else if (this.state.type.keyword) {
    node.name = this.state.type.keyword;
  } else {
    this.unexpected();
  }
  this.next();
  return this.finishNode(node, "JSXIdentifier");
};

// Parse namespaced identifier.

pp.jsxParseNamespacedName = function() {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  const name = this.jsxParseIdentifier();
  if (!this.eat(tt.colon)) return name;

  const node = this.startNodeAt(startPos, startLoc);
  node.namespace = name;
  node.name = this.jsxParseIdentifier();
  return this.finishNode(node, "JSXNamespacedName");
};

// Parses element name in any form - namespaced, member
// or single identifier.

pp.jsxParseElementName = function() {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  let node = this.jsxParseNamespacedName();
  while (this.eat(tt.dot)) {
    const newNode = this.startNodeAt(startPos, startLoc);
    newNode.object = node;
    newNode.property = this.jsxParseIdentifier();
    node = this.finishNode(newNode, "JSXMemberExpression");
  }
  return node;
};

// Parses any type of JSX attribute value.

pp.jsxParseAttributeValue = function() {
  let node;
  switch (this.state.type) {
    case tt.braceL:
      node = this.jsxParseExpressionContainer();
      if (node.expression.type === "JSXEmptyExpression") {
        this.raise(node.start, "JSX attributes must only be assigned a non-empty expression");
      } else {
        return node;
      }

    case tt.jsxTagStart:
    case tt.string:
      node = this.parseExprAtom();
      node.extra = null;
      return node;

    default:
      this.raise(this.state.start, "JSX value should be either an expression or a quoted JSX text");
  }
};

// JSXEmptyExpression is unique type since it doesn't actually parse anything,
// and so it should start at the end of last read token (left brace) and finish
// at the beginning of the next one (right brace).

pp.jsxParseEmptyExpression = function() {
  const node = this.startNodeAt(this.state.lastTokEnd, this.state.lastTokEndLoc);
  return this.finishNodeAt(node, "JSXEmptyExpression", this.state.start, this.state.startLoc);
};

// Parse JSX spread child

pp.jsxParseSpreadChild = function() {
  const node = this.startNode();
  this.expect(tt.braceL);
  this.expect(tt.ellipsis);
  node.expression = this.parseExpression();
  this.expect(tt.braceR);

  return this.finishNode(node, "JSXSpreadChild");
};

// Parses JSX expression enclosed into curly brackets.


pp.jsxParseExpressionContainer = function() {
  const node = this.startNode();
  this.next();
  if (this.match(tt.braceR)) {
    node.expression = this.jsxParseEmptyExpression();
  } else {
    node.expression = this.parseExpression();
  }
  this.expect(tt.braceR);
  return this.finishNode(node, "JSXExpressionContainer");
};

// Parses following JSX attribute name-value pair.

pp.jsxParseAttribute = function() {
  const node = this.startNode();
  if (this.eat(tt.braceL)) {
    this.expect(tt.ellipsis);
    node.argument = this.parseMaybeAssign();
    this.expect(tt.braceR);
    return this.finishNode(node, "JSXSpreadAttribute");
  }
  node.name = this.jsxParseNamespacedName();
  node.value = this.eat(tt.eq) ? this.jsxParseAttributeValue() : null;
  return this.finishNode(node, "JSXAttribute");
};

// Parses JSX opening tag starting after "<".

pp.jsxParseOpeningElementAt = function(startPos, startLoc) {
  const node = this.startNodeAt(startPos, startLoc);
  node.attributes = [];
  node.name = this.jsxParseElementName();
  while (!this.match(tt.slash) && !this.match(tt.jsxTagEnd)) {
    node.attributes.push(this.jsxParseAttribute());
  }
  node.selfClosing = this.eat(tt.slash);
  this.expect(tt.jsxTagEnd);
  return this.finishNode(node, "JSXOpeningElement");
};

// Parses JSX closing tag starting after "</".

pp.jsxParseClosingElementAt = function(startPos, startLoc) {
  const node = this.startNodeAt(startPos, startLoc);
  node.name = this.jsxParseElementName();
  this.expect(tt.jsxTagEnd);
  return this.finishNode(node, "JSXClosingElement");
};

// Parses entire JSX element, including it"s opening tag
// (starting after "<"), attributes, contents and closing tag.

pp.jsxParseElementAt = function(startPos, startLoc) {
  const node = this.startNodeAt(startPos, startLoc);
  const children = [];
  const openingElement = this.jsxParseOpeningElementAt(startPos, startLoc);
  let closingElement = null;

  if (!openingElement.selfClosing) {
    contents: for (;;) {
      switch (this.state.type) {
        case tt.jsxTagStart:
          startPos = this.state.start; startLoc = this.state.startLoc;
          this.next();
          if (this.eat(tt.slash)) {
            closingElement = this.jsxParseClosingElementAt(startPos, startLoc);
            break contents;
          }
          children.push(this.jsxParseElementAt(startPos, startLoc));
          break;

        case tt.jsxText:
          children.push(this.parseExprAtom());
          break;

        case tt.braceL:
          if (this.lookahead().type === tt.ellipsis) {
            children.push(this.jsxParseSpreadChild());
          } else {
            children.push(this.jsxParseExpressionContainer());
          }

          break;

        // istanbul ignore next - should never happen
        default:
          this.unexpected();
      }
    }

    if (getQualifiedJSXName(closingElement.name) !== getQualifiedJSXName(openingElement.name)) {
      this.raise(
        closingElement.start,
        "Expected corresponding JSX closing tag for <" + getQualifiedJSXName(openingElement.name) + ">"
      );
    }
  }

  node.openingElement = openingElement;
  node.closingElement = closingElement;
  node.children = children;
  if (this.match(tt.relational) && this.state.value === "<") {
    this.raise(this.state.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
  }
  return this.finishNode(node, "JSXElement");
};

// Parses entire JSX element from current position.

pp.jsxParseElement = function() {
  const startPos = this.state.start;
  const startLoc = this.state.startLoc;
  this.next();
  return this.jsxParseElementAt(startPos, startLoc);
};

export default function(instance) {
  instance.extend("parseExprAtom", function(inner) {
    return function(refShortHandDefaultPos) {
      if (this.match(tt.jsxText)) {
        const node = this.parseLiteral(this.state.value, "JSXText");
        // https://github.com/babel/babel/issues/2078
        node.extra = null;
        return node;
      } else if (this.match(tt.jsxTagStart)) {
        return this.jsxParseElement();
      } else {
        return inner.call(this, refShortHandDefaultPos);
      }
    };
  });

  instance.extend("readToken", function(inner) {
    return function(code) {
      if (this.state.inPropertyName) return inner.call(this, code);

      // don't allow jsx inside match case tests
      if (this.hasPlugin("lightscript") && this.state.inMatchCaseTest) {
        return inner.call(this, code);
      }

      const context = this.curContext();

      if (this.hasPlugin("lightscript") && code === 60) {
        const next = this.state.input.charCodeAt(this.state.pos + 1);

        // short-circuit for `<-` and `<!-`
        // DUP in flow plugin
        if (next === 45 || next === 33) {
          return inner.apply(this, arguments);
        }

        // fix ASI for jsxTagStart
        if (this.isLineBreak() && isIdentifierStart(next)) {
          ++this.state.pos;
          return this.finishToken(tt.jsxTagStart);
        }
      }

      if (context === tc.j_expr) {
        return this.jsxReadToken();
      }

      if (context === tc.j_oTag || context === tc.j_cTag) {
        if (isIdentifierStart(code)) {
          return this.jsxReadWord();
        }

        if (code === 62) {
          ++this.state.pos;
          return this.finishToken(tt.jsxTagEnd);
        }

        if ((code === 34 || code === 39) && context === tc.j_oTag) {
          return this.jsxReadString(code);
        }
      }

      if (code === 60 && this.state.exprAllowed) {
        ++this.state.pos;
        return this.finishToken(tt.jsxTagStart);
      }

      return inner.call(this, code);
    };
  });

  instance.extend("updateContext", function(inner) {
    return function(prevType) {
      if (this.match(tt.braceL)) {
        const curContext = this.curContext();
        if (curContext === tc.j_oTag) {
          this.state.context.push(tc.braceExpression);
        } else if (curContext === tc.j_expr) {
          this.state.context.push(tc.templateQuasi);
        } else {
          inner.call(this, prevType);
        }
        this.state.exprAllowed = true;
      } else if (this.match(tt.slash) && prevType === tt.jsxTagStart) {
        this.state.context.length -= 2; // do not consider JSX expr -> JSX open tag -> ... anymore
        this.state.context.push(tc.j_cTag); // reconsider as closing tag context
        this.state.exprAllowed = false;
      } else {
        return inner.call(this, prevType);
      }
    };
  });
}
