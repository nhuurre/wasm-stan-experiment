## Experimental WebAssembly Stan

Stan in your web browser. Consists of two parts:
- A minimal web frontend for [httpstan](https://github.com/stan-dev/httpstan). Built using [d3.js](https://d3js.org/) and [protobuf.js](https://github.com/protobufjs/protobuf.js).
- NodeJS-based drop-in replacement for **httpstan**. This is uses [express.js](http://expressjs.com/) and **protobuf.js**.

The frontend can use plain **httpstan** instead of the new NodeJS server. Start `httpstan-client.py` script and open `http://localhost:8080/static/index.html` in your web browser.

In order to use WebAssembly you need to install [Emscripten](https://emscripten.org/) and [CmdStan](https://github.com/stan-dev/cmdstan).
Set environment variable `CMDSTAN_PATH` to the CmdStan directory so that `$CMDSTAN_PATH/bin/stanc` is the Stan compiler.
Once that is done `node --experimental-worker server/main.js` starts the server.

After models have been compiled a static web server also works. I've set up GitHub Pages [to demonstrate](https://nhuurre.github.io/wasm-stan-experiment/client/index.html).

It also possible to use this server as the backend for [pystan-next](https://github.com/stan-dev/pystan-next). For example `pystan-test.py` script starts the server and runs `pytest` in the current working directory.

Currently two **pystan-next** tests fail.
- `test_model_build_data.py:test_data_wrong_dtype` This tests if converting an integer list to a float list causes the sampler to reject it. However, the values in the list are all still equal to integers and therefore the input is accepted as Javascript makes no intrinsic distinction between integers and floating point numbers. If any of the numbers is changed to a non-integral value the test passes.
- `test_linear_regression.py` Uses 10000x3 array which is apparently too large and crashes the server. The test passes if the size is 1000x3.


