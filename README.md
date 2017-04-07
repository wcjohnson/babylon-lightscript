# @oigroup/babylon-lightscript

> NB: This is a fork of babylon-lightscript which implements language changes that are not necessarily endorsed by upstream. Generally speaking, our intent is to closely follow the upstream language -- however, there may be notable deviations which are documented below.

The parser for [LightScript](http://lightscript.org).
To be used with [@oigroup/babel-plugin-lightscript](https://github.com/wcjohnson/babel-plugin-lightscript).

A minimally-invasive fork of [Babylon](https://github.com/babel/babylon).
With the exception of a few reserved keywords,
it parses JS as JS unless the `"lightscript"` plugin is passed.

### Contributing

    yarn
    npm run build
    npm test

New tests should go in the
[lightscript](https://github.com/lightscript/babylon-lightscript/tree/lightscript/test/fixtures/lightscript)
directory.

### Deviations from LightScript proper

#### If Statements and Expressions

(See https://github.com/wcjohnson/babylon-lightscript/issues/2)

`@oigroup/babylon-lightscript` enforces consistent syntax between if statements and if expressions, so that programmers don't encounter land mines when switching between the two. In practical terms, this means:

1. This is now illegal syntax:
```js
if a: {x} else b
```
If you use colon syntax on one clause of an `if` you must use it on all clauses.

2. This is now legal syntax:
```js
y = if(three()) 3 else 4
```
Traditional JavaScript `if` syntax now works with `if` expressions (as it should, since it works for `if` statements).
