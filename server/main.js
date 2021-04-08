'use strict';

const express = require('express');

const routes = require('./routes.js');

async function main(host, port) {
  const app = express();
  await routes.install(app);
  const server = app.listen(port, () => {
    console.log(`server ready http://${host}:${port}/client/index.html`);
  });
}

const { argv } = require('process');
const host = (argv[2] === undefined) ? 'localhost' : argv[2];
const port = (argv[3] === undefined) ? 8000 : argv[3];

main(host, port);
