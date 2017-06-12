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

// Holdovers from upstream babylon
// runFixtureTests(path.join(__dirname, "expressions"), parseExpression);
