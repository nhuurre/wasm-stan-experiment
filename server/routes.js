'use strict';

const { dirname, join } = require('path');

let cache;
let fits;

const server_settings = {};

async function setup() {
  cache = require('./cache.js');
  await cache.setup();
  server_settings.list_models = true;
  server_settings.wasm = true;
  server_settings.compile = false;
  try {
    fits = require('./fits.js');
    server_settings.fit = true;
  } catch (err) {
    server_settings.fit = false;
    console.warn('Model fitting not possible due to following error');
    console.warn(err);
  }
}

function send_error(response, status, msg) {
  response.status(status);
  response.json({
    code: status,
    //status: phrase
    message: msg
  });
}

function handle_health(request, response) {
  response.json(server_settings);
}

function handle_list_models(request, response) {
  const list = cache.list_models();
  response.json(list);
}

async function handle_params(request, response) {
  const model_id = request.params[0];
  const { data, random_seed } = request.body;
  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  try {
    const params = await fits.get_params(model, data, random_seed);
    response.json({
      name: model.name,
      params: params
    });
  } catch (err) {
    send_error(response, 400, err.message);
  }
}

function handle_create_fit(request, response) {
  const model_id = request.params[0];
  const data = request.body['data'];
  const func = request.body['function'];
  const options = {};
  for (let a in request.body)
    if (a !== 'data' && a !== 'function')
      options[a] = request.body[a];

  if (func !== 'stan::services::sample::hmc_nuts_diag_e_adapt')
    return send_error(response, 400, `Function ${func} not supported.`);

  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  const operation = fits.start_fit_task(model, data, options);

  response.status(201);
  response.json(operation);
}

function handle_get_fit(request, response) {
  const model_id = request.params[0];
  const fit_id = request.params[1];
  const fit = cache.lookup_fit(fit_id);
  if (!fit || fit.model_id !== model_id)
    return send_error(response, 404,
    `Fit models/${model_id}/fits/${fit_id} not found.`);
  response.sendFile(fit.fit_file, { root: cache.cache_dir });
}

function handle_operation(request, response) {
  const op_id = request.params[0];
  const operation = cache.lookup_operation(op_id);
  if (operation)
    response.json(operation);
  else
    send_error(response, 404,
    `Operation operations/${op_id} not found.`);
}

function handle_model_info(request, response) {
  const model_id = request.params[0];
  const ext = request.params[1];
  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  switch (ext) {
  case 'stan':
    response.sendFile(join('models', model.id, 'model.stan'), {
      root: cache.cache_dir,
      headers: {'Content-Type': 'text/plain'}
    });
    break;
  case 'js':
    response.sendFile(join('models', model.id, 'model.js'), {
      root: cache.cache_dir,
      headers: {'Content-Type': 'application/javascript'}
    });
    break;
  case 'wasm':
    response.sendFile(join('models', model.id, 'model.wasm'), {
      root: cache.cache_dir,
      headers: {'Content-Type': 'application/wasm'}
    });
    break;
  default:
    send_error(response, 500, `bad file extension .${ext}`);
  }
}

exports.install = install;
async function install(app) {
  await setup();
  const express = require('express');
  app.get('/write_all', async(_, res) => {await cache.write_models(); res.send('Cache updated.');});
  app.use('/static', express.static(join(dirname(__dirname), 'client')));
  app.get('/v1/health', handle_health);
  if (server_settings.list_models)
    app.get('/v1/list-models', handle_list_models);
  if (server_settings.fit) {
    app.post(/\/v1\/models\/([0-9a-f]+)\/params/, express.json(), express.urlencoded({extended: true}), handle_params);
    app.post(/\/v1\/models\/([0-9a-f]+)\/fits/, express.json(), express.urlencoded({extended: true}), handle_create_fit);
  }
  app.get(/\/v1\/models\/([0-9a-f]+)\/fits\/([0-9a-f]+)/, handle_get_fit);
  app.get(/\/v1\/operations\/([0-9a-f]+)/, handle_operation);
  if (server_settings.wasm)
    app.get(/\/v1\/models\/([0-9a-f]+)\/model\.(stan|js|wasm)/, handle_model_info);

}
