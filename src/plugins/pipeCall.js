import Parser from "../parser";
import { types as tt, TokenType } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__pipeCallPluginInstalled) return;
  parser.__pipeCallPluginInstalled = true;

  tt.pipeCall = new TokenType("|>");

  pp.parsePipeCall = function(node, left) {
    this.next();

    node.left = left;

    // Left-associative parsing of pipeCalls
    const right = this.parseExprAtom();
    if (this.match(tt.pipeCall)) {
      node.right = right;
    } else {
      node.right = this.parseSubscripts(right, this.state.start, this.state.startLoc, true);
    }

    return this.finishNode(node, "PipeCallExpression");
  };
}
