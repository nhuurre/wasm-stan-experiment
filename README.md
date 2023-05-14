## Experimental WebAssembly Stan

Stan in your web browser. Consists of two parts:
- WebStan client. A minimal web frontend for [httpstan](https://github.com/stan-dev/httpstan). Built using [d3.js](https://d3js.org/).
- NodeStan backend. A drop-in replacement for **httpstan** server. This uses [express.js](http://expressjs.com/).

The frontend works as a static web page; simply start a static web server in this directory, e.g. `python3 -mhttp.server` and open `http//localhost:8000/client/index.html` in your browser. Also available as GitHub Pages [demo](https://nhuurre.github.io/wasm-stan-experiment/client/index.html). The static server is very limited however and cannot compile new models.
Compiling (without WASM) is enabled when using plain old **httpstan** as the backend. Install **httpstan** and then start `httpstan_client.py` script and (again) open `http://localhost:8000/client/index.html`.

Of course the real reason you're reading this is compiling new WASM models. To do so you must first install [Emscripten](https://emscripten.org/) and [CmdStan](https://github.com/stan-dev/cmdstan).
You may set the environment variable `CMDSTAN` to the CmdStan directory so that `$CMDSTAN/bin/stanc` is the Stan compiler. If the variable is not set then the latest CmdStan installation found in `~/.cmdstan` directory is used.
Now you can compile and run a new model from the command line
```sh
node cmdstan.js model.stan data.json
```
The above runs NUTS with default arguments and produces file `output.csv` like CmdStan does.
The command line interface does not accept any other arguments. For more control start a local NodeStan server with
```sh
node server/main.js
```
and open the WebStan client `http://localhost:8000/client/index.html` in your browser. From there it is possible to compile models to WASM and run them in either NodeJS on the server side or inside your web browser.

Finally, [PyStan 3](https://github.com/stan-dev/pystan) interacts with Stan through **httpstan** backend and it is in theory possible to use NodeStan as that backend.
Import `pystan_test.py` in your interactive Python session and call `monkeypatch_pystan()`.
Alternatively clone the PyStan repo and simply run `python3 ../wasm-stan/pystan_test.py` in that repo. As a script, it monkeypatches the backend and then runs **pytest** as if you had invoked `python3 -mpytest`. A few tests are skipped, see the code. Also works in the **httpstan** repo. (The skipped tests are chosen based on the name of the current working directory.)

