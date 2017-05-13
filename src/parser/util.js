import { types as tt } from "../tokenizer/types";
import Parser from "./index";
import { lineBreak } from "../util/whitespace";

const pp = Parser.prototype;

// ## Parser utilities

// TODO

pp.addExtra = function (node, key, val) {
  if (!node) return;

  const extra = node.extra = node.extra || {};
  extra[key] = val;
};

// TODO

pp.isRelational = function (op) {
  return this.match(tt.relational) && this.state.value === op;
};

// TODO

pp.expectRelational = function (op) {
  if (this.isRelational(op)) {
    this.next();
  } else {
    this.unexpected(null, tt.relational);
  }
};

// Tests whether parsed token is a contextual keyword.

pp.isContextual = function (name) {
  return this.match(tt.name) && this.state.value === name;
};

// Consumes contextual keyword if possible.

pp.eatContextual = function (name) {
  return this.state.value === name && this.eat(tt.name);
};

// Asserts that following token is given contextual keyword.

pp.expectContextual = function (name, message) {
  if (!this.eatContextual(name)) this.unexpected(null, message);
};

// added for lightscript

pp.isLineBreak = function () {
  if (this.hasPlugin("lightscript")) {
    // treat start-of-file as newline.
    // TODO: reconsider/reevaluate
    if (!this.state.lastTokEnd) return true;
  }
  return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
};

// Test whether a semicolon can be inserted at the current position.

pp.canInsertSemicolon = function () {
  return this.match(tt.eof) ||
    this.match(tt.braceR) ||
    this.isLineBreak() ||
    (this.hasPlugin("lightscript") && (
      // LSC oneline statement ASI cases
      // Allow if x: throw y else: throw z
      this.match(tt._else) ||
      this.match(tt._elif) ||
      // Allow (-> throw new Error)()
      this.match(tt.parenR) ||
      // Technically it is legal to insert a ; after a ;.
      // Allows -> throw new Error; f()
      this.state.tokens[this.state.tokens.length - 1].type === tt.semi
    ));
};

// TODO

pp.isLineTerminator = function () {
  return this.eat(tt.semi) || this.canInsertSemicolon();
};

// Consume a semicolon, or, failing that, see if we are allowed to
// pretend that there is a semicolon at this position.

pp.semicolon = function () {
  if (!this.isLineTerminator()) this.unexpected(null, tt.semi);
};

// Expect a token of a given type. If found, consume it, otherwise,
// raise an unexpected token error at given pos.

pp.expect = function (type, pos) {
  return this.eat(type) || this.unexpected(pos, type);
};

// Expect, but without eating

pp.check = function (type, pos) {
  return this.match(type) || this.unexpected(pos, type);
};

// Raise an unexpected token error. Can take the expected token type
// instead of a message string.

pp.unexpected = function (pos, messageOrType = "Unexpected token") {
  if (messageOrType && typeof messageOrType === "object" && messageOrType.label) {
    messageOrType = `Unexpected token, expected ${messageOrType.label}`;
  }
  this.raise(pos != null ? pos : this.state.start, messageOrType);
};
