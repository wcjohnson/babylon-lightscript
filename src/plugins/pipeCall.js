import Parser from "../parser";
import { types as tt, TokenType } from "../tokenizer/types";
const pp = Parser.prototype;

export default function(parser) {
  if (parser.__pipeCallPluginInstalled) return;
  parser.__pipeCallPluginInstalled = true;

  tt.pipeCall = new TokenType("|>");

  pp.parsePipeCall = function(node, left) {
    if (this.state.value === "|>") {
      return this.parseRightPointingPipeCall(node, left);
    } else {
      return this.parseLeftPointingPipeCall(node, left);
    }
  };

  pp.parseRightPointingPipeCall = function(node, left) {
    this.next();

    node.left = left;

    // To get left-associative parsing for pipe calls, we can't let the RHS
    // of a pipe call subscript into another pipe call.
    // Thus we use a state flag to prevent deep parsing of pipe calls
    // Hackish but avoids changing the core args of parseSubscripts
    if (this.match(tt.parenL) || this.match(tt.name)) {
      this.state.potentialArrowAt = this.state.start;
    }
    const right = this.parseExprAtom();
    this.state.noPipeSubscripts = true;
    node.right = this.parseSubscripts(right, this.state.start, this.state.startLoc);

    return this.finishNode(node, "PipeCallExpression");
  };

  pp.parseLeftPointingPipeCall = function(node, left) {
    this.next();

    node.left = left;
    if (this.match(tt.parenL) || this.match(tt.name)) {
      this.state.potentialArrowAt = this.state.start;
    }
    node.right = this.parseSubscripts(this.parseExprAtom(), this.state.start, this.state.startLoc);
    node.reversed = true;

    return this.finishNode(node, "PipeCallExpression");
  };
}
