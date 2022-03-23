# js-resources

[![pipeline status](https://gitlab.com/MatrixAI/open-source/js-resources/badges/master/pipeline.svg)](https://gitlab.com/MatrixAI/open-source/js-resources/commits/master)

Resource context management inspired by Python's `with` context manager and Haskell's bracket pattern.

## Installation

```sh
npm install --save @matrixai/resources
```

## Development

Run `nix-shell`, and once you're inside, you can use:

```sh
# install (or reinstall packages from package.json)
npm install
# build the dist
npm run build
# run the repl (this allows you to import from ./src)
npm run ts-node
# run the tests
npm run test
# lint the source code
npm run lint
# automatically fix the source
npm run lintfix
```

### Docs Generation

```sh
npm run docs
```

See the docs at: https://matrixai.github.io/js-resources/

### Publishing

```sh
# npm login
npm version patch # major/minor/patch
npm run build
npm publish --access public
git push
git push --tags
```
