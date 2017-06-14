import { reservedWords } from "../util/identifier";
import { getOptions } from "../options";
import Tokenizer from "../tokenizer";

export const plugins = {};
export const pluginMetadata = {};

const frozenDeprecatedWildcardPluginList = [
  "jsx",
  "doExpressions",
  "objectRestSpread",
  "decorators",
  "classProperties",
  "exportExtensions",
  "asyncGenerators",
  "functionBind",
  "functionSent",
  "dynamicImport",
  "flow"
];

export default class Parser extends Tokenizer {
  constructor(options: Object, input: string) {
    options = getOptions(options);
    super(options, input);

    this.options = options;
    this.inModule = this.options.sourceType === "module";
    this.input = input;
    this.plugins = this.loadPlugins(this.options.plugins);
    this.filename = options.sourceFilename;

    // If enabled, skip leading hashbang line.
    if (this.state.pos === 0 && this.input[0] === "#" && this.input[1] === "!") {
      this.skipLineComment(2);
    }
  }

  isReservedWord(word: string): boolean {
    if (word === "await") {
      return this.inModule;
    } else {
      return reservedWords[6](word);
    }
  }

  hasPlugin(name: string): boolean {
    if (this.plugins["*"] && frozenDeprecatedWildcardPluginList.indexOf(name) > -1) {
      return true;
    }

    return !!this.plugins[name];
  }

  extend(name: string, f: Function) {
    this[name] = f(this[name]);
  }

  loadAllPlugins() {
    // ensure flow plugin loads last, also ensure estree is not loaded with *
    const pluginNames = Object.keys(plugins).filter((name) => name !== "flow" && name !== "estree");
    pluginNames.push("flow");

    pluginNames.forEach((name) => {
      const plugin = plugins[name];
      if (plugin) plugin(this);
    });
  }

  loadPlugins(pluginList: Array<string>): { [key: string]: boolean } {
    // TODO: Deprecate "*" option in next major version of Babylon
    if (pluginList.indexOf("*") >= 0) {
      this.loadAllPlugins();

      return { "*": true };
    }

    const pluginMap = {};
    pluginList = pluginList.slice();

    for (let i = 0; i < pluginList.length; i++) {
      const name = pluginList[i];
      if (pluginMetadata[name] && pluginMetadata[name].dependencies) {
        for (const dep of pluginMetadata[name].dependencies) {
          if (pluginList.indexOf(dep) < 0) {
            pluginList.splice(i, 0, dep);
          }
        }
      }
    }

    if (pluginList.indexOf("flow") >= 0) {
      // ensure flow plugin loads last
      pluginList = pluginList.filter((plugin) => plugin !== "flow");
      pluginList.push("flow");
    }

    if (pluginList.indexOf("estree") >= 0) {
      // ensure estree plugin loads first
      pluginList = pluginList.filter((plugin) => plugin !== "estree");
      pluginList.unshift("estree");
    }

    for (const name of pluginList) {
      if (!pluginMap[name]) {
        pluginMap[name] = true;

        const plugin = plugins[name];
        if (plugin) plugin(this);
      }
    }

    return pluginMap;
  }

  parse(): {
    type: "File",
    program: {
      type: "Program",
      body: Array<Object>
    }
  } {
    const file = this.startNode();
    const program = this.startNode();
    this.nextToken();
    return this.parseTopLevel(file, program);
  }
}
