'use strict';

const fs = require('fs');
const workers = require('worker_threads');
const { dirname, join } = require('path');
const { createHash } = require('crypto');

const cache = require('./cache.js');

const cmdstan_defaults = require('../client/cmdstan-help-all.json');

const sampler_default_args = {
  random_seed: 4,
  chain: 0,
  init_radius: 2.0,
};
for (let arg of cmdstan_defaults.method.sample)
  if (arg.type === 'double' || arg.type === 'int' ||
      arg.type === 'unsigned int' || arg.type === 'boolean')
    if (arg.name !== 'int_time' && arg.name !== 'engaged')
      if (arg.name === 'thin')
        sampler_default_args['num_thin'] = Number(arg.default);
      else
        sampler_default_args[arg.name] = Number(arg.default);
for (let arg of cmdstan_defaults.output)
  if (arg.name === 'refresh')
    sampler_default_args.refresh = Number(arg.default);

exports.calculate_fit_id = calculate_fit_id;
function calculate_fit_id(model, func, data, options) {
  const hash = createHash('blake2b512');
  hash.update(model.name);
  hash.update(func);
  let list = [];
  for (let x in options)
    list.push([x, options[x]]);
  hash.update(JSON.stringify(list.sort()));
  list = [];
  for (let x in data)
    list.push([x, data[x]]);
  hash.update(JSON.stringify(list.sort()));
  return hash.digest('hex').slice(0,16);
}

exports.start_fit_task = start_fit_task;
function start_fit_task(model_id, model, func, data, options) {
  options = {
    ...sampler_default_args,
    ...options
    };
  const fit_id = calculate_fit_id(model, func, data, options);
  let fit = cache.lookup_fit(fit_id);
  if (fit)
    return {
      name: fit.op_name,
      done: true,
      result: { name: fit.fit_name },
      metadata: {
        fit: { name: fit.fit_name }
      }
    };
  let operation = cache.lookup_operation(fit_id);
  if (!operation) {
    fit = {
      model_id: model_id,
      model_name: model.name,
      func: func,
      fit_id: fit_id,
      fit_name: `${model.name}/fits/${fit_id}`,
      op_name: `operations/${fit_id}`,
    };
    operation = {
      name: fit.op_name,
      done: false,
      metadata: {
        fit: { name: fit.fit_name }
      }
    };
    cache.store_operation(fit_id, operation);
    run_sampler(model, fit, data, options, operation);
  }
  return operation;
}

exports.log_prob_task = log_prob_task;
function log_prob_task(model, data, unconstrained_parameters, adjust_transform, random_seed) {
  const task = {
    cmd: 'log_prob',
    data,
    unconstrained_parameters,
    adjust_transform: adjust_transform !== undefined ? adjust_transform : true,
    random_seed: random_seed !== undefined ? random_seed : sampler_default_args.random_seed
  };
  return worker_task(model, task);
}

exports.log_prob_grad_task = log_prob_grad_task;
function log_prob_grad_task(model, data, unconstrained_parameters, adjust_transform, random_seed) {
  const task = {
    cmd: 'log_prob_grad',
    data,
    unconstrained_parameters,
    adjust_transform: adjust_transform !== undefined ? adjust_transform : true,
    random_seed: random_seed !== undefined ? random_seed : sampler_default_args.random_seed
  };
  return worker_task(model, task);
}

exports.get_params_task = get_params_task;
function get_params_task(model, data, random_seed) {
  const task = {
    cmd: 'get_params',
    data,
    random_seed: random_seed !== undefined ? random_seed : sampler_default_args.random_seed
  };
  return worker_task(model, task);
}

exports.write_array_task = write_array_task;
function write_array_task(model, data, unconstrained_parameters, include_tparams, include_gqs, random_seed) {
  const task = {
    cmd: 'write_array',
    data,
    unconstrained_parameters,
    include_tparams: include_tparams !== undefined ? include_tparams : true,
    include_gqs: include_gqs !== undefined ? include_gqs : true,
    random_seed: random_seed !== undefined ? random_seed : sampler_default_args.random_seed
  };
  return worker_task(model, task);
}

exports.transform_inits_task = transform_inits_task;
function transform_inits_task(model, data, constrained_parameters, random_seed) {
  const task = {
    cmd: 'transform_inits',
    data,
    constrained_parameters,
    random_seed: random_seed !== undefined ? random_seed : sampler_default_args.random_seed
  };
  return worker_task(model, task);
}

function worker_task(model, task, update) {
  return new Promise((resolve, reject) => {
    const thread = new workers.Worker(cache.file(model.name, 'model.js'));
    thread.on('error', reject);
    thread.on('message', ({info, payload}) => {
      switch (info) {
      case 'ready':
        thread.postMessage(task);
        break;
      case 'update':
        if (update)
          update(payload);
        break;
      case 'done':
        setTimeout(() => {
          thread.terminate();
          resolve(payload);
        }, 10);
        break;
      case 'error':
        setTimeout(() => {
          thread.terminate();
          reject(new Error(payload));
        }, 10);
        break;
      case 'debug':
        console.log(payload);
        break;
      default:
        console.error(`unknown message ${info}`);
      }
    });
  });
}

exports.run_worker = run_worker;
async function run_worker(model, data, options) {
  const task = {
    cmd: 'hmc_nuts_diag_e_adapt',
    data: data,
    args: {
      ...sampler_default_args,
      ...options
      }
  };
  const samples = {};
  await worker_task(model, task, (payload) => {
    switch (payload.topic) {
    case 'logger':
      for (let s of payload.values)
        console.log(s);
      break;
    case 'initialization':
      break;
    case 'sample':
      if (payload.values instanceof Array)
        for (let s of payload.values)
          console.log(s);
      else
        for (let name in payload.values) {
          if (!(name in samples))
            samples[name] = [];
          samples[name].push(payload.values[name]);
        }
      break;
    case 'diagnostic':
      break;
    }
  });
  return samples;
}

async function run_sampler(model, fit, data, options, operation) {
  fit.fit_file = join(model.name, fit.fit_id);
  const task = {
    cmd: fit.func,
    data: data,
    args: options
  };
  const buffer = [];
  const err = await worker_task(model, task, (payload) => {
    buffer.push(JSON.stringify({version: 1, ...payload}) + '\n');
    if (payload.topic === 'logger' && payload.values.length === 1) {
      const info = payload.values[0];
      if (info.startsWith('info:Iteration'))
        operation.metadata.progress = info.slice(5);
    }
  }).catch((err) => err);
  if (err) {
    operation.result = { code: 400, message: err.message };
    operation.done = true;
  } else {
    fs.writeFile(cache.file(fit.fit_file), buffer.join(''), (err) => {
      if (err) {
        operation.result = { code: 400, message: err.message };
        operation.done = true;
      } else {
        cache.store_fit(fit);
        operation.result = { name: fit.fit_name };
        operation.done = true;
      }
    });
  }
}

