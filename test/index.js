import path from "path";
import { runFixtureTests, runTestsWithLightScript } from "./helpers/runFixtureTests";
import { parse } from "../lib";

runFixtureTests(path.join(__dirname, "fixtures"), parse);
runTestsWithLightScript(path.join(__dirname, "fixtures"), parse);
