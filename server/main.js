'use strict';

const express = require('express');

const routes = require('./routes.js');

async function main(host, port) {
  const app = express();
  await routes.install(app);
  const server = app.listen(port, () => {
    console.log(`listening  port ${port}`);
  });
}

const port = 8080;
const host = "127.0.0.1";

main(host, port);
