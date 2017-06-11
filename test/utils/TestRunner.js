const misMatch = require("./misMatch");
const avaTest = require("ava");
const getTopics = require("babel-helper-fixtures").multiple;
const readFile = require("babel-helper-fixtures").readFile;
const resolve = require("try-resolve");
const fs = require("fs");

exports = module.exports = {};

class FilterTests {
  exclude(name) {
    this.exclusions = (this.exclusions || []).concat([name]);
  }
  only(name) {
    if (name) {
      this.exclusions = null;
      this.onlyStr = name;
    }
  }
  filter(name) {
    if (this.exclusions) {
      for (const exclusion of this.exclusions) {
        if (name.indexOf(exclusion) > -1) return false;
      }
    } else if (this.onlyStr) {
      if (name.indexOf(this.onlyStr) < 0) return false;
    }
    return true;
  }
}

exports.TestRun = class TestRun extends FilterTests {
  constructor(parser, config = {}) {
    super();
    this.allPlugins = parser.getAvailablePlugins();
    this.parser = parser;
    this.config = config;
    if (!this.config.TestClass) this.config.TestClass = exports.Test;
    if (config.only) {
      this.onlyConfig = config.only;
      this.only(this.onlyConfig.topic);
    }
  }

  runTopics(topicsPath) {
    console.log("*** Enqueueing test run");
    this.path = topicsPath;
    const topics = getTopics(topicsPath);
    let nTests = 0;
    Object.keys(topics).forEach((topicName) => {
      if (this.filter(topicName)) {
        const topic = new Topic(this, topicName, topics[topicName]);
        nTests = topic.run();
        console.log(topicName, ": enqueued ", nTests, " tests.");
      }
    });
  }
};

class Topic extends FilterTests {
  constructor(testRun, topicName, suites) {
    super();
    this.testRun = testRun;
    this.name = topicName;
    this.path = testRun.path + "/" + topicName;
    this.suites = suites;
    if (this.testRun.onlyConfig) {
      this.only(this.testRun.onlyConfig.suite);
    }
  }

  run() {
    let nTests = 0;
    this.suites.forEach((suite) => {
      if (this.filter(suite.title)) {
        const theSuite = new Suite(this, suite);
        nTests += theSuite.run();
      }
    });
    return nTests;
  }
}

class Suite extends FilterTests {
  constructor(topic, suite) {
    super();
    this.topic = topic;
    this.testRun = this.topic.testRun;
    this.name = suite.title;
    this.babelSuite = suite;
    if (this.testRun.onlyConfig) {
      this.only(this.testRun.onlyConfig.task);
    }
  }

  run() {
    let nTests = 0;
    this.babelSuite.tests.forEach((test) => {
      if (this.filter(test.title)) {
        const theTest = new TestCase(this, test);
        nTests += theTest.run();
      }
    });
    return nTests;
  }
}

class TestCase {
  constructor(suite, test) {
    this.suite = suite;
    this.babelTest = test;
    this.testRun = this.suite.testRun;
    this.TestClass = this.testRun.config.TestClass;
  }

  run() {
    let nTests = 0;
    const theTest = new this.TestClass(this);
    theTest.fromBabelTest(this.babelTest);
    nTests += theTest.run();
    return nTests;
  }
}

exports.Test = class Test {
  constructor(testCase, test) {
    this.testCase = testCase;
    this.suite = testCase.suite;
    this.topic = this.suite.topic;
    this.testRun = this.suite.testRun;
    this.babelTest = test;
    this.name = "(unnamed)";
    this.disabled = false;
    this.parserOpts = {};
  }

  // Import a test parsed by the babel fixture runner
  fromBabelTest(test) {
    this.babelTest = test;
    this.name = test.title;
    this.actualFile = test.actual.loc;
    this.actualCode = test.actual.code;
    this.expectedCode = test.expect.code;
    this.throws = test.options.throws;
    this.expectedFile = test.expect.loc;
    this.disabled = test.disabled;
    this.parserOpts = test.options;
  }

  fixup() {
    // Modify the test before sending it to ava
  }

  run() {
    this.fixup();

    const avaFn = this.disabled ? avaTest.skip : avaTest;

    const _this = this;
    avaFn(this.topic.name + "/" + this.suite.name + "/" + this.name, () => {
      try {
        return _this.testBody();
      } catch (err) {
        err.message = this.actualFile + ": " + err.message;
        throw err;
      }
    });

    return 1;
  }

  save(ast, whereTo) {
    delete ast.tokens;
    if (ast.comments && !ast.comments.length) delete ast.comments;

    // Ensure that RegExp are serialized as strings
    const toJSON = RegExp.prototype.toJSON;
    RegExp.prototype.toJSON = RegExp.prototype.toString;
    fs.writeFileSync(whereTo, JSON.stringify(ast, null, "  "));
    RegExp.prototype.toJSON = toJSON;
  }

  testBody() {
    const parseFunction = this.testRun.parser.parse;
    const opts = this.parserOpts;
    let ast = null, diff = null;
    opts.locations = true;
    opts.ranges = true;

    if (this.throws && this.expectedCode) {
      throw new Error("File expected.json exists although options specify throws. Remove expected.json.");
    }

    try {
      ast = parseFunction(this.actualCode, opts);
    } catch (err) {
      if (this.throws) {
        if (err.message === this.throws) {
          return;
        } else {
          err.message = "Expected error message: " + this.throws + ". Got error message: " + err.message;
          throw err;
        }
      }

      throw err;
    }

    if (!this.expectedCode && !this.throws && !process.env.CI) {
      if (this.expectedFile.indexOf(".json") < 0) this.expectedFile += "on";
      return this.save(ast, this.expectedFile);
    }

    if (this.throws) {
      throw new Error("Expected error message: " + this.throws + ". But parsing succeeded.");
    } else {
      diff = misMatch(JSON.parse(this.expectedCode), ast);
      if (diff) {
        //save(test, ast);
        throw new Error(diff);
      }
    }
  }
};
