## Experimental WebAssembly Stan

Stan in your web browser. Consists of two parts:
- A minimal web frontend for [httpstan](https://github.com/stan-dev/httpstan). Built using [d3.js](https://d3js.org/) and [protobuf.js](https://github.com/protobufjs/protobuf.js).
- NodeJS-based drop-in replacement for **httpstan**. This is uses [express.js](http://expressjs.com/) and **protobuf.js**.

The frontend can use plain **httpstan** instead of the new NodeJS server. Start `httpstan-client.py` script and open `http://localhost:8080/static/index.html` in your web browser.

Alternatively `node --experimental-worker server/main.js` starts the new server.

