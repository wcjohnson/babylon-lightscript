import Parser from "../parser";
const pp = Parser.prototype;
import { nonASCIIwhitespace } from "../util/whitespace";

export default function(parser) {
  if (parser.__significantWhitespacePluginInstalled) return;
  parser.__significantWhitespacePluginInstalled = true;

  parser.extend("skipSpace", function() {
    return function skipSpace() {
      let isNewLine = this.state.pos === 0;  // for lightscript
      loop: while (this.state.pos < this.input.length) {
        const ch = this.input.charCodeAt(this.state.pos);
        switch (ch) {
          case 160:
            this.unexpected(null, "Non-breaking space is illegal in " +
            "significant-whitespace mode; use a normal space.");


          case 32: // ' '
            ++this.state.pos;

            // DUP in `jsxReadNewLine()`
            if (isNewLine) {
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
            if (ch !== 13) {
              this.unexpected(null, "Only '\\n' and '\\r\\n' are legal newlines " +
              "in significant-whitespace mode.");
            }

          case 10:
            ++this.state.pos;
            ++this.state.curLine;
            this.state.lineStart = this.state.pos;
            isNewLine = true;
            this.state.indentLevel = 0;
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
              this.unexpected(null, "Only normal whitespace (ascii-32) is allowed.");
            } else {
              break loop;
            }
        }
      }
    };
  });

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

  // detect whether we're on a (non-indented) newline
  // relative to another position, eg;
  // x y -> false
  // x\ny -> true
  // x\n  y -> false
  pp.isNonIndentedBreakFrom = function (pos) {
    const indentLevel = this.indentLevelAt(pos);
    return this.isLineBreak() && this.state.indentLevel <= indentLevel;
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

  // lightscript only allows plain space (ascii-32), \r\n, and \n.
  // note that the space could appear within a string.
  pp.isWhitespaceAt = function (pos) {
    const ch = this.state.input.charCodeAt(pos);
    return (ch === 32 || ch === 13 || ch === 10);
  };

  pp.isNextCharWhitespace = function () {
    return this.isWhitespaceAt(this.state.end);
  };

  // In whitespace-sensitive parsing, it is often useful to look back to
  // an opening construct that is at the same indent level as a later
  // closing construct. The block stack enables this pattern.
  pp.pushBlockState = function (blockType, indentLevel) {
    this.state.blockStack.push({ blockType, indentLevel });
  };

  pp.matchBlockState = function(blockType, indentLevel) {
    return this.state.blockStack.some( (x) => x.blockType === blockType && x.indentLevel === indentLevel );
  };

  pp.popBlockState = function() {
    this.state.blockStack.pop();
  };
}
