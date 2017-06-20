function ppJSON(v) {
  v = v instanceof RegExp ? v.toString() : v;
  return JSON.stringify(v, null, 2);
}

function addPath(str, pt) {
  if (str.charAt(str.length - 1) == ")") {
    return str.slice(0, str.length - 1) + "/" + pt + ")";
  } else {
    return str + " (" + pt + ")";
  }
}

module.exports = function misMatch(exp, act) {
  let left = null, right = null, mis = null;
  if (exp instanceof RegExp || act instanceof RegExp) {
    left = ppJSON(exp);
    right = ppJSON(act);
    if (left !== right) return left + " !== " + right;
  } else if (Array.isArray(exp)) {
    if (!Array.isArray(act)) return ppJSON(exp) + " != " + ppJSON(act);
    if (act.length != exp.length) return "array length mismatch " + exp.length + " != " + act.length;
    for (let i = 0; i < act.length; ++i) {
      mis = misMatch(exp[i], act[i]);
      if (mis) return addPath(mis, i);
    }
  } else if (!exp || !act || (typeof exp != "object") || (typeof act != "object")) {
    if (exp !== act && typeof exp != "function")
      return ppJSON(exp) + " !== " + ppJSON(act);
  } else  {
    for (const prop in exp) {
      mis = misMatch(exp[prop], act[prop]);
      if (mis) return addPath(mis, prop);
    }
  }
}
