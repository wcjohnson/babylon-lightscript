/* eslint max-len: 0 */

import type { TokenType } from "./types";
import { isIdentifierStart, isIdentifierChar, isKeyword } from "../util/identifier";
import { types as tt, keywords as keywordTypes } from "./types";
import { types as ct } from "./context";
import { SourceLocation } from "../util/location";
import { lineBreak, lineBreakG, isNewLine, nonASCIIwhitespace } from "../util/whitespace";
import State from "./state";

// Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

export class Token {
  constructor(state) {
    this.type = state.type;
    this.value = state.value;
    this.start = state.start;
    this.end = state.end;
    this.loc = new SourceLocation(state.startLoc, state.endLoc);
  }

  type: TokenType;
  value: any;
  start: number;
  end: number;
  loc: SourceLocation;
}

// ## Tokenizer

function codePointToString(code) {
  // UTF-16 Decoding
  if (code <= 0xFFFF) {
    return String.fromCharCode(code);
  } else {
    return String.fromCharCode(((code - 0x10000) >> 10) + 0xD800, ((code - 0x10000) & 1023) + 0xDC00);
  }
}

export default class Tokenizer {
  constructor(options, input) {
    this.state = new State;
    this.state.init(options, input);
  }

  // Move to the next token

  next() {
    if (!this.isLookahead) {
      this.state.tokens.push(new Token(this.state));
    }

    this.state.lastTokEnd = this.state.end;
    this.state.lastTokStart = this.state.start;
    this.state.lastTokEndLoc = this.state.endLoc;
    this.state.lastTokStartLoc = this.state.startLoc;
    this.nextToken();
  }

  // TODO

  eat(type) {
    if (this.match(type)) {
      this.next();
      return true;
    } else {
      return false;
    }
  }

  // TODO

  match(type) {
    return this.state.type === type;
  }

  // TODO

  isKeyword(word) {
    return isKeyword(word);
  }

  // TODO

  lookahead() {
    const old = this.state;
    this.state = old.clone(true);

    this.isLookahead = true;
    this.next();
    this.isLookahead = false;

    const curr = this.state.clone(true);
    this.state = old;
    return curr;
  }

  // Toggle strict mode. Re-reads the next number or string to please
  // pedantic tests (`"use strict"; 010;` should fail).

  setStrict(strict) {
    this.state.strict = strict;
    if (!this.match(tt.num) && !this.match(tt.string)) return;
    this.state.pos = this.state.start;
    while (this.state.pos < this.state.lineStart) {
      this.state.lineStart = this.input.lastIndexOf("\n", this.state.lineStart - 2) + 1;
      --this.state.curLine;
    }
    this.nextToken();
  }

  curContext() {
    return this.state.context[this.state.context.length - 1];
  }

  // Read a single token, updating the parser object's token-related
  // properties.

  nextToken() {
    const curContext = this.curContext();
    if (!curContext || !curContext.preserveSpace) this.skipSpace();

    this.state.containsOctal = false;
    this.state.octalPosition = null;
    this.state.start = this.state.pos;
    this.state.startLoc = this.state.curPosition();
    if (this.state.pos >= this.input.length) return this.finishToken(tt.eof);

    if (curContext.override) {
      return curContext.override(this);
    } else {
      return this.readToken(this.fullCharCodeAtPos());
    }
  }

  readToken(code) {
    // Identifier or keyword. '\uXXXX' sequences are allowed in
    // identifiers, so '\' also dispatches to that.
    if (isIdentifierStart(code) || code === 92 /* '\' */) {
      return this.readWord();
    } else {
      return this.getTokenFromCode(code);
    }
  }

  fullCharCodeAtPos() {
    const code = this.input.charCodeAt(this.state.pos);
    if (code <= 0xd7ff || code >= 0xe000) return code;

    const next = this.input.charCodeAt(this.state.pos + 1);
    return (code << 10) + next - 0x35fdc00;
  }

  pushComment(block, text, start, end, startLoc, endLoc) {
    const comment = {
      type: block ? "CommentBlock" : "CommentLine",
      value: text,
      start: start,
      end: end,
      loc: new SourceLocation(startLoc, endLoc)
    };

    if (!this.isLookahead) {
      this.state.tokens.push(comment);
      this.state.comments.push(comment);
      this.addComment(comment);
    }
  }

  skipBlockComment() {
    const startLoc = this.state.curPosition();
    const start = this.state.pos;
    const end = this.input.indexOf("*/", this.state.pos += 2);
    if (end === -1) this.raise(this.state.pos - 2, "Unterminated comment");

    this.state.pos = end + 2;
    lineBreakG.lastIndex = start;
    let match;
    while ((match = lineBreakG.exec(this.input)) && match.index < this.state.pos) {
      ++this.state.curLine;
      this.state.lineStart = match.index + match[0].length;
    }

    this.pushComment(true, this.input.slice(start + 2, end), start, this.state.pos, startLoc, this.state.curPosition());
  }

  skipLineComment(startSkip) {
    const start = this.state.pos;
    const startLoc = this.state.curPosition();
    let ch = this.input.charCodeAt(this.state.pos += startSkip);
    while (this.state.pos < this.input.length && ch !== 10 && ch !== 13 && ch !== 8232 && ch !== 8233) {
      ++this.state.pos;
      ch = this.input.charCodeAt(this.state.pos);
    }

    this.pushComment(false, this.input.slice(start + startSkip, this.state.pos), start, this.state.pos, startLoc, this.state.curPosition());
  }

  // Called at the start of the parse and after every token. Skips
  // whitespace and comments, and.

  skipSpace() {
    let isNewLine = false;  // for lightscript
    loop: while (this.state.pos < this.input.length) {
      const ch = this.input.charCodeAt(this.state.pos);
      switch (ch) {
        case 160:
          if (this.hasPlugin("lightscript")) {
            this.unexpected(null, "nbsp is illegal in lightscript; use a normal space.");
          }

        case 32: // ' '
          ++this.state.pos;

          // DUP in `jsxReadNewLine()`
          if (this.hasPlugin("lightscript") && isNewLine) {
            if (this.input.charCodeAt(this.state.pos) === 32) {
              ++this.state.pos;
              ++this.state.indentLevel;
            } else {
              // TODO: consider
              // this.unexpected(null, "Odd indentation.");
            }
          }
          break;

        case 13:
          if (this.input.charCodeAt(this.state.pos + 1) === 10) {
            ++this.state.pos;
          }

        case 8232: case 8233:
          if (this.hasPlugin("lightscript") && ch !== 13) {
            this.unexpected(null, "Only '\\n' and '\\r\\n' are legal newlines in lightscript.");
          }
        case 10:
          ++this.state.pos;
          ++this.state.curLine;
          this.state.lineStart = this.state.pos;
          if (this.hasPlugin("lightscript")) {
            isNewLine = true;
            this.state.indentLevel = 0;
          }
          break;

        case 47: // '/'
          switch (this.input.charCodeAt(this.state.pos + 1)) {
            case 42: // '*'
              this.skipBlockComment();
              break;

            case 47:
              this.skipLineComment(2);
              break;

            default:
              break loop;
          }
          break;

        default:
          if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
            if (this.hasPlugin("lightscript")) this.unexpected(null, "Only normal whitespace (ascii-32) is allowed.");
            ++this.state.pos;
          } else {
            break loop;
          }
      }
    }
  }

  // Called at the end of every token. Sets `end`, `val`, and
  // maintains `context` and `exprAllowed`, and skips the space after
  // the token, so that the next one's `start` will point at the
  // right position.

  finishToken(type, val) {
    this.state.end = this.state.pos;
    this.state.endLoc = this.state.curPosition();
    const prevType = this.state.type;
    this.state.type = type;
    this.state.value = val;

    this.updateContext(prevType);
  }

  // ### Token reading

  // This is the function that is called to fetch the next token. It
  // is somewhat obscure, because it works in character codes rather
  // than characters, and because operator parsing has been inlined
  // into it.
  //
  // All in the name of speed.
  //
  readToken_dot() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    // in lightscript, numbers cannot start with a naked `.`
    if (next >= 48 && next <= 57 && !this.hasPlugin("lightscript")) {
      return this.readNumber(true);
    }

    const next2 = this.input.charCodeAt(this.state.pos + 2);
    if (next === 46 && next2 === 46) { // 46 = dot '.'
      this.state.pos += 3;
      return this.finishToken(tt.ellipsis);
    } else {
      ++this.state.pos;
      return this.finishToken(tt.dot);
    }
  }

  readToken_slash() { // '/'
    const looksLikeRegex = this.hasPlugin("lightscript") &&
      this.isLineBreak() &&
      !this.isWhitespaceAt(this.state.pos + 1) &&
      // if parsing jsx, allow `/>` etc.
      (!this.hasPlugin("jsx") || (
        this.curContext() !== ct.j_oTag &&
        this.curContext() !== ct.j_cTag
      ));

    if (this.state.exprAllowed || looksLikeRegex) {
      ++this.state.pos;
      return this.readRegexp();
    }

    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    } else {
      return this.finishOp(tt.slash, 1);
    }
  }

  readToken_mult_modulo(code) { // '%*'
    let type = code === 42 ? tt.star : tt.modulo;
    let width = 1;
    let next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 42) { // '*'
      width++;
      next = this.input.charCodeAt(this.state.pos + 2);
      type = tt.exponent;
    }

    if (next === 61) {
      width++;
      type = tt.assign;
    }

    return this.finishOp(type, width);
  }

  readToken_pipe_amp(code) { // '|&'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === code) return this.finishOp(code === 124 ? tt.logicalOR : tt.logicalAND, 2);
    if (next === 61) return this.finishOp(tt.assign, 2);
    if (code === 124 && next === 125 && this.hasPlugin("flow")) return this.finishOp(tt.braceBarR, 2);
    return this.finishOp(code === 124 ? tt.bitwiseOR : tt.bitwiseAND, 1);
  }

  readToken_caret() { // '^'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    } else {
      return this.finishOp(tt.bitwiseXOR, 1);
    }
  }

  readToken_plus_min(code) { // '+-'
    const next = this.input.charCodeAt(this.state.pos + 1);

    if (next === code) {
      if (next === 45 && this.input.charCodeAt(this.state.pos + 2) === 62 && lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.pos))) {
        // A `-->` line comment
        this.skipLineComment(3);
        this.skipSpace();
        return this.nextToken();
      }
      return this.finishOp(tt.incDec, 2);
    }

    // lightscript '->'
    // TODO: dedup w/ fat
    if (this.hasPlugin("lightscript") && code === 45) {
      if (next === 62) {
        this.state.pos += 2;
        return this.finishToken(tt.arrow, "->");
      }
      const next2 = this.input.charCodeAt(this.state.pos + 2);
      if (next === 47 && next2 === 62) {
        this.state.pos += 3;
        return this.finishToken(tt.arrow, "-/>");
      }
      if (next === 42 && next2 === 62) {
        this.state.pos += 3;
        return this.finishToken(tt.arrow, "-*>");
      }

      let getOrSet;
      if (next === 103) getOrSet = "get";
      if (next === 115) getOrSet = "set";
      if (getOrSet && next2 === 101 &&
        this.input.charCodeAt(this.state.pos + 3) === 116 &&
        this.input.charCodeAt(this.state.pos + 4) === 62
      ) {
        this.state.pos += 5;
        return this.finishToken(tt.arrow, `-${getOrSet}>`);
      }
    }

    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    } else {
      return this.finishOp(tt.plusMin, 1);
    }
  }

  readToken_lt_gt(code) { // '<>'
    const next = this.input.charCodeAt(this.state.pos + 1);
    let size = 1;

    if (next === code) {
      size = code === 62 && this.input.charCodeAt(this.state.pos + 2) === 62 ? 3 : 2;
      if (this.input.charCodeAt(this.state.pos + size) === 61) return this.finishOp(tt.assign, size + 1);
      return this.finishOp(tt.bitShift, size);
    }

    if (next === 33 && code === 60 && this.input.charCodeAt(this.state.pos + 2) === 45 && this.input.charCodeAt(this.state.pos + 3) === 45) {
      if (this.inModule) this.unexpected();
      // `<!--`, an XML-style comment that should be interpreted as a line comment
      this.skipLineComment(4);
      this.skipSpace();
      return this.nextToken();
    }

    if (this.hasPlugin("lightscript") && code === 60) {
      // <-
      if (next === 45) {
        return this.finishOp(tt.awaitArrow, 2);
      }
      // <!-
      if (next === 33 && this.input.charCodeAt(this.state.pos + 2) === 45) {
        return this.finishOp(tt.awaitArrow, 3);
      }
    }

    if (next === 61) {
      // <= | >=
      size = 2;
    }

    return this.finishOp(tt.relational, size);
  }

  readToken_eq_excl(code) { // '=!'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) return this.finishOp(tt.equality, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);

    // lightscript '=>'
    // TODO: dedup w/ skinny
    if (this.hasPlugin("lightscript") && code === 61) {
      if (next === 62) {
        this.state.pos += 2;
        return this.finishToken(tt.arrow, "=>");
      }

      const next2 = this.input.charCodeAt(this.state.pos + 2);
      if (next === 47 && next2 === 62) {
        this.state.pos += 3;
        return this.finishToken(tt.arrow, "=/>");
      }
      if (next === 42 && next2 === 62) {
        this.state.pos += 3;
        return this.finishToken(tt.arrow, "=*>");
      }
    }

    if (code === 61 && next === 62) { // '=>'
      this.state.pos += 2;
      return this.finishToken(tt.arrow);
    }

    return this.finishOp(code === 61 ? tt.eq : tt.prefix, 1);
  }

  getTokenFromCode(code) {
    switch (code) {
      // The interpretation of a dot depends on whether it is followed
      // by a digit or another two dots.
      case 46: // '.'
        return this.readToken_dot();

      // Punctuation tokens.
      case 40: ++this.state.pos; return this.finishToken(tt.parenL);
      case 41: ++this.state.pos; return this.finishToken(tt.parenR);
      case 59: ++this.state.pos; return this.finishToken(tt.semi);
      case 44: ++this.state.pos; return this.finishToken(tt.comma);
      case 91: ++this.state.pos; return this.finishToken(tt.bracketL);
      case 93: ++this.state.pos; return this.finishToken(tt.bracketR);

      case 123:
        if (this.hasPlugin("flow") && this.input.charCodeAt(this.state.pos + 1) === 124) {
          return this.finishOp(tt.braceBarL, 2);
        } else {
          ++this.state.pos;
          return this.finishToken(tt.braceL);
        }

      case 125:
        ++this.state.pos; return this.finishToken(tt.braceR);

      case 58:
        if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
          return this.finishOp(tt.doubleColon, 2);
        } else {
          ++this.state.pos;
          return this.finishToken(tt.colon);
        }

      case 63:
        if (this.hasPlugin("lightscript")) {
          const next = this.input.charCodeAt(this.state.pos + 1);
          // `?.` or `?[`
          if (next === 46 || next === 91) {
            return this.finishOp(tt.elvis, 2);
          }
        }
        ++this.state.pos;
        return this.finishToken(tt.question);
      case 64: ++this.state.pos; return this.finishToken(tt.at);

      case 96: // '`'
        ++this.state.pos;
        return this.finishToken(tt.backQuote);

      case 48: // '0'
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 120 || next === 88) return this.readRadixNumber(16); // '0x', '0X' - hex number
        if (next === 111 || next === 79) return this.readRadixNumber(8); // '0o', '0O' - octal number
        if (next === 98 || next === 66) return this.readRadixNumber(2); // '0b', '0B' - binary number
        // Anything else beginning with a digit is an integer, octal
        // number, or float.
      case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
        return this.readNumber(false);

        // Quotes produce strings.
      case 34: case 39: // '"', "'"
        return this.readString(code);

      // Operators are parsed inline in tiny state machines. '=' (61) is
      // often referred to. `finishOp` simply skips the amount of
      // characters it is given as second argument, and returns a token
      // of the type given by its first argument.

      case 47: // '/'
        return this.readToken_slash();

      case 37: case 42: // '%*'
        return this.readToken_mult_modulo(code);

      case 124: case 38: // '|&'
        return this.readToken_pipe_amp(code);

      case 94: // '^'
        return this.readToken_caret();

      case 43: case 45: // '+-'
        return this.readToken_plus_min(code);

      case 60: case 62: // '<>'
        return this.readToken_lt_gt(code);

      case 61: case 33: // '=!'
        return this.readToken_eq_excl(code);

      case 126: // '~'
        if (this.hasPlugin("lightscript")) {
          ++this.state.pos;
          return this.finishToken(tt.tilde);
        } else {
          return this.finishOp(tt.prefix, 1);
        }

    }

    this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
  }

  finishOp(type, size) {
    const str = this.input.slice(this.state.pos, this.state.pos + size);
    this.state.pos += size;
    return this.finishToken(type, str);
  }

  readRegexp() {
    const start = this.state.pos;
    let escaped, inClass;

    if (this.hasPlugin("lightscript") && this.input.charCodeAt(start) === 32) {
      this.raise(start, "Regex literals cannot start with a space in lightscript; try '\\s' or '\\ ' instead.");
    }

    // for lightscript, exprAllowed logic may have been overriden; possibly confusing, try to clarify.
    const unterminatedErrMsg = !this.state.exprAllowed
      ? "Unterminated regular expression (if you wanted division, add a space after the '/')."
      : "Unterminated regular expression";

    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(start, unterminatedErrMsg);
      const ch = this.input.charAt(this.state.pos);
      if (lineBreak.test(ch)) {
        this.raise(start, unterminatedErrMsg);
      }
      if (escaped) {
        escaped = false;
      } else {
        if (ch === "[") {
          inClass = true;
        } else if (ch === "]" && inClass) {
          inClass = false;
        } else if (ch === "/" && !inClass) {
          break;
        }
        escaped = ch === "\\";
      }
      ++this.state.pos;
    }
    const content = this.input.slice(start, this.state.pos);
    ++this.state.pos;
    // Need to use `readWord1` because '\uXXXX' sequences are allowed
    // here (don't ask).
    const mods = this.readWord1();
    if (mods) {
      const validFlags = /^[gmsiyu]*$/;
      if (!validFlags.test(mods)) this.raise(start, "Invalid regular expression flag");
    }
    return this.finishToken(tt.regexp, {
      pattern: content,
      flags: mods
    });
  }

  // Read an integer in the given radix. Return null if zero digits
  // were read, the integer value otherwise. When `len` is given, this
  // will return `null` unless the integer has exactly `len` digits.

  readInt(radix, len) {
    const start = this.state.pos;
    let total = 0;

    for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
      const code = this.input.charCodeAt(this.state.pos);
      let val;
      if (code >= 97) {
        val = code - 97 + 10; // a
      } else if (code >= 65) {
        val = code - 65 + 10; // A
      } else if (code >= 48 && code <= 57) {
        val = code - 48; // 0-9
      } else  {
        val = Infinity;
      }
      if (val >= radix) break;
      ++this.state.pos;
      total = total * radix + val;
    }
    if (this.state.pos === start || len != null && this.state.pos - start !== len) return null;

    return total;
  }

  readRadixNumber(radix) {
    this.state.pos += 2; // 0x
    const val = this.readInt(radix);
    if (val == null) this.raise(this.state.start + 2, "Expected number in radix " + radix);
    if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, "Identifier directly after number");
    return this.finishToken(tt.num, val);
  }

  // Read an integer, octal integer, or floating-point number.

  readNumber(startsWithDot) {
    const start = this.state.pos;
    const octal = this.input.charCodeAt(this.state.pos) === 48;
    let isFloat = false;

    // for numeric array access (eg; arr.0), don't read floats (numbers with a decimal).
    const noFloatsAllowed = this.hasPlugin("lightscript") &&
      this.state.tokens.length > 0 &&
      this.state.tokens[this.state.tokens.length - 1].type === tt.dot;

    if (!startsWithDot && this.readInt(10) === null) this.raise(start, "Invalid number");
    let next = this.input.charCodeAt(this.state.pos);
    if (next === 46 && !noFloatsAllowed) { // '.'
      ++this.state.pos;
      this.readInt(10);
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }
    if (next === 69 || next === 101) { // 'eE'
      next = this.input.charCodeAt(++this.state.pos);
      if (next === 43 || next === 45) ++this.state.pos; // '+-'
      if (this.readInt(10) === null) this.raise(start, "Invalid number");
      isFloat = true;
    }
    // don't read the decimal if it's not followed by a number; `1.` is illegal, must do `1.0`
    if (this.hasPlugin("lightscript") && this.input.charCodeAt(this.state.pos - 1) === 46) {
      --this.state.pos;
    }
    if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, "Identifier directly after number");

    const str = this.input.slice(start, this.state.pos);
    let val;
    if (isFloat) {
      val = parseFloat(str);
    } else if (!octal || str.length === 1) {
      val = parseInt(str, 10);
    } else if (/[89]/.test(str) || this.state.strict) {
      this.raise(start, "Invalid number");
    } else {
      val = parseInt(str, 8);
    }
    return this.finishToken(tt.num, val);
  }

  // Read a string value, interpreting backslash-escapes.

  readCodePoint() {
    const ch = this.input.charCodeAt(this.state.pos);
    let code;

    if (ch === 123) {
      const codePos = ++this.state.pos;
      code = this.readHexChar(this.input.indexOf("}", this.state.pos) - this.state.pos);
      ++this.state.pos;
      if (code > 0x10FFFF) this.raise(codePos, "Code point out of bounds");
    } else {
      code = this.readHexChar(4);
    }
    return code;
  }

  readString(quote) {
    let out = "", chunkStart = ++this.state.pos;
    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated string constant");
      const ch = this.input.charCodeAt(this.state.pos);
      if (ch === quote) break;
      if (ch === 92) { // '\'
        out += this.input.slice(chunkStart, this.state.pos);
        out += this.readEscapedChar(false);
        chunkStart = this.state.pos;
      } else {
        if (isNewLine(ch)) this.raise(this.state.start, "Unterminated string constant");
        ++this.state.pos;
      }
    }
    out += this.input.slice(chunkStart, this.state.pos++);
    return this.finishToken(tt.string, out);
  }

  // Reads template string tokens.

  readTmplToken() {
    let out = "", chunkStart = this.state.pos;
    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated template");
      const ch = this.input.charCodeAt(this.state.pos);
      if (ch === 96 || ch === 36 && this.input.charCodeAt(this.state.pos + 1) === 123) { // '`', '${'
        if (this.state.pos === this.state.start && this.match(tt.template)) {
          if (ch === 36) {
            this.state.pos += 2;
            return this.finishToken(tt.dollarBraceL);
          } else {
            ++this.state.pos;
            return this.finishToken(tt.backQuote);
          }
        }
        out += this.input.slice(chunkStart, this.state.pos);
        return this.finishToken(tt.template, out);
      }
      if (ch === 92) { // '\'
        out += this.input.slice(chunkStart, this.state.pos);
        out += this.readEscapedChar(true);
        chunkStart = this.state.pos;
      } else if (isNewLine(ch)) {
        out += this.input.slice(chunkStart, this.state.pos);
        ++this.state.pos;
        switch (ch) {
          case 13:
            if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos;
          case 10:
            out += "\n";
            break;
          default:
            out += String.fromCharCode(ch);
            break;
        }
        ++this.state.curLine;
        this.state.lineStart = this.state.pos;
        chunkStart = this.state.pos;
      } else {
        ++this.state.pos;
      }
    }
  }

  // Used to read escaped characters

  readEscapedChar(inTemplate) {
    const ch = this.input.charCodeAt(++this.state.pos);
    ++this.state.pos;
    switch (ch) {
      case 110: return "\n"; // 'n' -> '\n'
      case 114: return "\r"; // 'r' -> '\r'
      case 120: return String.fromCharCode(this.readHexChar(2)); // 'x'
      case 117: return codePointToString(this.readCodePoint()); // 'u'
      case 116: return "\t"; // 't' -> '\t'
      case 98: return "\b"; // 'b' -> '\b'
      case 118: return "\u000b"; // 'v' -> '\u000b'
      case 102: return "\f"; // 'f' -> '\f'
      case 13: if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos; // '\r\n'
      case 10: // ' \n'
        this.state.lineStart = this.state.pos;
        ++this.state.curLine;
        return "";
      default:
        if (ch >= 48 && ch <= 55) {
          let octalStr = this.input.substr(this.state.pos - 1, 3).match(/^[0-7]+/)[0];
          let octal = parseInt(octalStr, 8);
          if (octal > 255) {
            octalStr = octalStr.slice(0, -1);
            octal = parseInt(octalStr, 8);
          }
          if (octal > 0) {
            if (!this.state.containsOctal) {
              this.state.containsOctal = true;
              this.state.octalPosition = this.state.pos - 2;
            }
            if (this.state.strict || inTemplate) {
              this.raise(this.state.pos - 2, "Octal literal in strict mode");
            }
          }
          this.state.pos += octalStr.length - 1;
          return String.fromCharCode(octal);
        }
        return String.fromCharCode(ch);
    }
  }

  // Used to read character escape sequences ('\x', '\u', '\U').

  readHexChar(len) {
    const codePos = this.state.pos;
    const n = this.readInt(16, len);
    if (n === null) this.raise(codePos, "Bad character escape sequence");
    return n;
  }

  // Read an identifier, and return it as a string. Sets `this.state.containsEsc`
  // to whether the word contained a '\u' escape.
  //
  // Incrementally adds only escaped chars, adding other chunks as-is
  // as a micro-optimization.

  readWord1() {
    this.state.containsEsc = false;
    let word = "", first = true, chunkStart = this.state.pos;
    while (this.state.pos < this.input.length) {
      const ch = this.fullCharCodeAtPos();
      if (isIdentifierChar(ch)) {
        this.state.pos += ch <= 0xffff ? 1 : 2;
      } else if (ch === 92) { // "\"
        this.state.containsEsc = true;

        word += this.input.slice(chunkStart, this.state.pos);
        const escStart = this.state.pos;

        if (this.input.charCodeAt(++this.state.pos) !== 117) { // "u"
          this.raise(this.state.pos, "Expecting Unicode escape sequence \\uXXXX");
        }

        ++this.state.pos;
        const esc = this.readCodePoint();
        if (!(first ? isIdentifierStart : isIdentifierChar)(esc, true)) {
          this.raise(escStart, "Invalid Unicode escape");
        }

        word += codePointToString(esc);
        chunkStart = this.state.pos;
      } else {
        break;
      }
      first = false;
    }
    return word + this.input.slice(chunkStart, this.state.pos);
  }

  // Read an identifier or keyword token. Will check for reserved
  // words when necessary.

  readWord() {
    const word = this.readWord1();
    let type = tt.name;
    if (!this.state.containsEsc && this.isKeyword(word)) {
      type = keywordTypes[word];
    }
    return this.finishToken(type, word);
  }

  braceIsBlock(prevType) {
    if (prevType === tt.colon) {
      const parent = this.curContext();
      if (parent === ct.braceStatement || parent === ct.braceExpression) {
        return !parent.isExpr;
      }
    }

    if (prevType === tt._return) {
      return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
    }

    if (prevType === tt._else || prevType === tt.semi || prevType === tt.eof || prevType === tt.parenR) {
      return true;
    }

    if (prevType === tt.braceL) {
      return this.curContext() === ct.braceStatement;
    }

    return !this.state.exprAllowed;
  }

  updateContext(prevType) {
    const type = this.state.type;
    let update;

    if (type.keyword && prevType === tt.dot) {
      this.state.exprAllowed = false;
    } else if (update = type.updateContext) {
      update.call(this, prevType);
    } else {
      this.state.exprAllowed = type.beforeExpr;
    }
  }
}
