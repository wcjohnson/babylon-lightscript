import path from "path";
import { runFixtureTests } from "./utils/runFixtureTests";
import { parse, parseExpression, getAvailablePlugins } from "../lib";
import { TestRun, Test } from "./utils/TestRunner";
import resolve from "try-resolve";
import { readFile } from "babel-helper-fixtures";

const parser = { parse, parseExpression, getAvailablePlugins };

// All fixtures with default options
let run = new TestRun(parser);
run.runTopics(path.join(__dirname, "fixtures"));

// All fixtures with lightscript added
class TestWithLsc extends Test {
  fixup() {
    const task = this.babelTest;
    task.options.plugins = task.options.plugins || [];
    task.options.plugins.push("lightscript");

    const lightOptionsLoc = resolve(task.actual.loc.replace("actual.js", "options.lightscript.json"));
    if (lightOptionsLoc) {
      const lightOptions = JSON.parse(readFile(lightOptionsLoc));
      this.parserOpts = Object.assign({}, this.parserOpts, lightOptions);
      this.throws = this.parserOpts.throws;
      delete this.expectedCode;
    }

    const lightExpectLoc = resolve(task.actual.loc.replace("actual.js", "expected.lightscript.json"));
    if (lightExpectLoc) {
      delete this.throws;
      this.expectedCode = readFile(lightExpectLoc);
      this.expectedFile = lightExpectLoc;
    }
  }
}

run = new TestRun(parser, { TestClass: TestWithLsc });
run.exclude("lightscript");
run.runTopics(path.join(__dirname, "fixtures"));

// Holdovers from upstream babylon
runFixtureTests(path.join(__dirname, "expressions"), parseExpression);
