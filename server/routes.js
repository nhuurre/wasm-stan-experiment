'use strict';

const { dirname, join } = require('path');

let cache;
let fits;
let compiler;

const server_settings = {};

async function setup() {
  cache = require('./cache.js');
  await cache.setup();
  server_settings.model_info = true;
  server_settings.random = true;
  server_settings.wasm = true;
  try {
    compiler = require('./compiler.js');
    await compiler.setup();
    server_settings.compile = true;
  } catch (err) {
    server_settings.compile = false;
    console.warn('Model compilation not possible due to following error');
    console.warn(err);
  }
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
    message: `ValueError(${JSON.stringify(msg)})`
  });
}

function handle_health(request, response) {
  response.json(server_settings);
}

function handle_list_models(request, response) {
  const list = cache.list_models();
  response.json(list);
}

async function handle_compile_model(request, response) {
  const body = request.body;
  const { program_code } = body;
  try {
    const model = await compiler.compile_model(program_code);
    response.status(201);
    response.json(model);
  } catch (err) {
    send_error(response, 400, err.message);
  }
}

async function handle_delete_model(request, response) {
  const model_id = request.params[0];
  if (await cache.delete_model(model_id)) {
    response.send('OK')
  } else {
    send_error(response, 404, `Model models/${model_id} not found.`);
  }
}

async function handle_params(request, response) {
  const model_id = request.params[0];
  const { data, random_seed } = request.body;
  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  try {
    const params = await fits.get_params_task(model, data, random_seed);
    response.json({
      name: model.name,
      params: params
    });
  } catch (err) {
    send_error(response, 400, err.message);
  }
}

async function handle_log_prob(request, response) {
  const model_id = request.params[0];
  const { data, unconstrained_parameters, adjust_transform, random_seed } = request.body;
  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  try {
    const lp = await fits.log_prob_task(model, data, unconstrained_parameters, adjust_transform, random_seed);
    response.json({
      log_prob: lp
    });
  } catch (err) {
    send_error(response, 400, err.message);
  }
}

async function handle_log_prob_grad(request, response) {
  const model_id = request.params[0];
  const { data, unconstrained_parameters, adjust_transform, random_seed } = request.body;
  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  try {
    const grad = await fits.log_prob_grad_task(model, data, unconstrained_parameters, adjust_transform, random_seed);
    response.json({
      log_prob_grad: grad
    });
  } catch (err) {
    send_error(response, 400, err.message);
  }
}

async function handle_write_array(request, response) {
  const model_id = request.params[0];
  const { data, unconstrained_parameters, include_tparams, include_gqs, random_seed } = request.body;
  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  try {
    const params = await fits.write_array_task(model, data, unconstrained_parameters, include_tparams, include_gqs, random_seed);
    response.json({
      params_r_constrained: params
    });
  } catch (err) {
    send_error(response, 400, err.message);
  }
}

async function handle_transform_inits(request, response) {
  const model_id = request.params[0];
  const { data, constrained_parameters, random_seed } = request.body;
  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  try {
    const params = await fits.transform_inits_task(model, data, constrained_parameters, random_seed);
    response.json({
      params_r_unconstrained: params
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

  if (func != 'stan::services::sample::hmc_nuts_diag_e_adapt' &&
      func != 'stan::services::sample::fixed_param')
    return send_error(response, 422, `Function ${func} not supported.`);

  const model = cache.lookup_model(model_id);
  if (!model)
    return send_error(response, 404,
    `Model models/${model_id} not found.`);

  const operation = fits.start_fit_task(model_id, model, func.split('::')[3], data, options);

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
  response.sendFile(fit.fit_file, {
      root: cache.cache_dir,
      headers: {'Content-Type': 'text/plain; charset=utf-8'}
    });
}

function handle_delete_fit(request, response) {
  const model_id = request.params[0];
  const fit_id = request.params[1];
  if (cache.delete_fit(fit_id)) {
    response.send('OK')
  } else {
    send_error(response, 404,
    `Fit models/${model_id}/fits/${fit_id} not found.`);
  }
}

function handle_operation(request, response) {
  const op_id = request.params[0];
  const operation = cache.lookup_operation(op_id);
  if (operation && !operation.cancelled)
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
    response.sendFile(join('models', model_id, 'model.stan'), {
      root: cache.cache_dir,
      headers: {'Content-Type': 'text/plain'}
    });
    break;
  case 'js':
    response.sendFile(join('models', model_id, 'model.js'), {
      root: cache.cache_dir,
      headers: {'Content-Type': 'application/javascript'}
    });
    break;
  case 'wasm':
    response.sendFile(join('models', model_id, 'model.wasm'), {
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
  app.use('/client', express.static(join(dirname(__dirname), 'client')));
  app.get('/v1/health', handle_health);
  app.get('/v1/models', handle_list_models);
  app.get('/v1/models.json', handle_list_models);
  if (server_settings.compile)
    app.post('/v1/models', express.json(), express.urlencoded({extended: true}), handle_compile_model);
  app.delete(/\/v1\/models\/([0-9a-f]+)$/, handle_delete_model);
  if (server_settings.fit) {
    app.post(/\/v1\/models\/([0-9a-f]+)\/params$/, express.json({limit: '1Mb'}), express.urlencoded({extended: true, limit: '1Mb'}), handle_params);
    app.post(/\/v1\/models\/([0-9a-f]+)\/fits$/, express.json({limit: '1Mb'}), express.urlencoded({extended: true, limit: '1Mb'}), handle_create_fit);
    app.post(/\/v1\/models\/([0-9a-f]+)\/log_prob_grad$/, express.json(), express.urlencoded({extended: true}), handle_log_prob_grad);
    app.post(/\/v1\/models\/([0-9a-f]+)\/log_prob$/, express.json(), express.urlencoded({extended: true}), handle_log_prob);
    app.post(/\/v1\/models\/([0-9a-f]+)\/write_array$/, express.json(), express.urlencoded({extended: true}), handle_write_array);
    app.post(/\/v1\/models\/([0-9a-f]+)\/transform_inits$/, express.json(), express.urlencoded({extended: true}), handle_transform_inits);
  }
  app.get(/\/v1\/models\/([0-9a-f]+)\/fits\/([0-9a-f]+)$/, handle_get_fit);
  app.delete(/\/v1\/models\/([0-9a-f]+)\/fits\/([0-9a-f]+)$/, handle_delete_fit);
  app.get(/\/v1\/operations\/([0-9a-f]+)$/, handle_operation);
  if (server_settings.wasm)
    app.get(/\/v1\/models\/([0-9a-f]+)\/model\.(stan|js|wasm)$/, handle_model_info);

}
