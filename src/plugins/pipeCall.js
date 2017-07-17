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

    // To get left-associative parsing for pipe calls, we can't let the RHS
    // of a pipe call subscript into another pipe call.
    // Thus we use a state flag to prevent deep parsing of pipe calls
    // Hackish but avoids changing the core args of parseSubscripts
    const right = this.parseExprAtom();
    this.state.noPipeSubscripts = true;
    node.right = this.parseSubscripts(right, this.state.start, this.state.startLoc);

    return this.finishNode(node, "PipeCallExpression");
  };
}
