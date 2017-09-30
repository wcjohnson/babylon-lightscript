import path from "path";
import { runFixtureTests } from "./utils/runFixtureTests";
import * as parser from "../lib";
import { TestRun, Test } from "./utils/TestRunner";
import resolve from "try-resolve";
import { readFile } from "babel-helper-fixtures";

// All fixtures with default options
const run = new TestRun(parser);
run.runTopics(path.join(__dirname, "fixtures"));

// Holdovers from upstream babylon
runFixtureTests(path.join(__dirname, "expressions"), parser.parseExpression);
