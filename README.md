# babylon-lightscript

The parser for [LightScript](http://lightscript.org), a concise syntax for JavaScript.

To be used through [babel-plugin-lightscript](https://github.com/lightscript/babel-plugin-lightscript).

A minimally-invasive fork of [Babylon](https://github.com/babel/babylon).
With the exception of a few reserved keywords,
it parses JS as JS unless the `"lightscript"` plugin is passed.


### Contributing

    yarn
    yarn build
    yarn test

New tests should go in the
[lightscript](https://github.com/lightscript/babylon-lightscript/tree/lightscript/test/fixtures/lightscript)
directory.
