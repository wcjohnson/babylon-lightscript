const misMatch = require("./misMatch");
const avaTest = require("ava");
const getTopics = require("babel-helper-fixtures").multiple;
const readFile = require("babel-helper-fixtures").readFile;
const resolve = require("try-resolve");
const fs = require("fs");
const path = require("path");
const merge = require("lodash/merge");

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
    this.path = path.join(testRun.path, topicName);
    const loc = resolve(path.join(this.path, "options"));
    if (loc) this.options = require(loc); else this.options = {};
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
    this.options = suite.options || {};
    if (this.testRun.onlyConfig) {
      this.only(this.testRun.onlyConfig.task);
    }
    this.inheritOptions();
  }

  inheritOptions() {
    if (!this.options.runImplicitDefaultAlternative)
      this.options.runImplicitDefaultAlternative = this.topic.options.runImplicitDefaultAlternative;

    this.options.alternatives = merge(this.options.alternatives || {}, this.topic.options.alternatives);
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
    this.options = this.babelTest.options || {};
    this.testRun = this.suite.testRun;
    this.TestClass = this.testRun.config.TestClass;
    this.inheritOptions();
  }

  inheritOptions() {
    if (!this.options.runImplicitDefaultAlternative)
      this.options.runImplicitDefaultAlternative = this.suite.options.runImplicitDefaultAlternative;

    this.options.alternatives = merge(this.options.alternatives || {}, this.suite.options.alternatives);
  }

  run() {
    let nTests = 0;
    if (this.babelTest.options && this.babelTest.options.alternatives) {
      for (const alternativeName in this.babelTest.options.alternatives) {
        const theTest = new this.TestClass(this);
        theTest.fromBabelTest(this.babelTest);
        theTest.withAlternative(alternativeName, this.babelTest.options.alternatives[alternativeName]);
        nTests += theTest.run();
      }
    }

    if (this.options.runImplicitDefaultAlternative) {
      const theTest = new this.TestClass(this);
      theTest.fromBabelTest(this.babelTest);
      nTests += theTest.run();
    }
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
    if (test.options) {
      this.parserOpts = Object.assign({}, test.options);
    }
  }

  withAlternative(altName, alt) {
    const task = this.babelTest;
    this.name += ` (${altName})`;

    let plugins;

    if (alt.allPlugins) {
      plugins = this.testRun.parser.getAvailablePlugins();
    } else if (this.parserOpts.plugins) {
      plugins = this.parserOpts.plugins.slice();
    } else {
      plugins = [];
    }

    plugins = this.excludePlugins(plugins, alt.excludePlugins);
    if (this.babelTest.options && this.babelTest.options.excludePlugins) {
      plugins = this.excludePlugins(plugins, this.babelTest.options.excludePlugins);
    }
    plugins = this.includePlugins(plugins, alt.includePlugins);

    this.parserOpts.plugins = plugins;

    if (alt.expected) {
      this.expectedFile = task.actual.loc.replace("actual.js", alt.expected);
      const loc = resolve(this.expectedFile);
      if (loc) {
        delete this.throws;
        this.expectedCode = readFile(loc);
      }
    }

    if (alt.throws) {
      this.throws = alt.throws;
      delete this.expectedCode;
    }

    if (alt.optionsOverride) {
      const loc = resolve(task.actual.loc.replace("actual.js", alt.optionsOverride));
      if (loc) {
        const opts = JSON.parse(readFile(loc));
        this.parserOpts = Object.assign({}, this.parserOpts, opts);
        if (opts.throws) {
          this.throws = opts.throws;
          delete this.expectedCode;
        }
      }
    }
  }

  includePlugins(plugins, list) {
    if (!list) return plugins;
    list.forEach((entry) => {
      if (plugins.indexOf(entry) < 0) plugins.push(entry);
    });
    return plugins;
  }

  excludePlugins(plugins, list) {
    if (!list) return plugins;
    return plugins.filter((entry) => {
      return list.indexOf(entry) < 0;
    });
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
