'use strict';

const fs = require('fs');
const workers = require('worker_threads');
const { dirname, join } = require('path');
const { createHash } = require('crypto');

const protobuf = require('protobufjs');

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
function calculate_fit_id(model, data, options) {
  const hash = createHash('blake2b512');
  hash.update(model.name);
  hash.update(JSON.stringify(options));
  hash.update(JSON.stringify(data));
  return hash.digest('hex').slice(0,16);
}

exports.start_fit_task = start_fit_task;
function start_fit_task(model, data, options) {
  // should add the defaults here so they're part of fit_id
  // but the order is arbitrary in the JSON representation
  const fit_id = calculate_fit_id(model, data, options);
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
      model_id: model.id,
      model_name: model.name,
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
    start_worker(model, fit, data, options, operation);
  }
  return operation;
}

exports.get_params = get_params;
function get_params(model, data, random_seed) {
  return new Promise((resolve, reject) => {
    const thread = new workers.Worker(cache.file('models', model.id, 'model.js'));
    thread.on('error', (err) => {
      reject(new Error(err));
      setTimeout(()=>void thread.terminate(), 0);
    });
    thread.on('message', (msg) => {
      switch (msg.info) {
      case 'ready':
        thread.postMessage({
          cmd: 'get_params',
          data: data,
          random_seed: random_seed !== undefined ? random_seed : sampler_default_args.random_seed
        });
        break;
      case 'debug':
        console.log(msg.msg);
        break;
      case 'params':
        resolve(msg.params);
        setTimeout(()=>void thread.terminate(), 0);
        break;
      case 'params-err':
        reject(new Error(msg.msg));
        setTimeout(()=>void thread.terminate(), 0);
      }
    });
  });
}

let stan_protobuf;
async function get_protobuf_writer() {
  if (stan_protobuf)
    return stan_protobuf;
  const path = join(dirname(__dirname), 'client', 'callbacks_writer.proto');
  const callbacks = await protobuf.load(path);
  stan_protobuf = callbacks.lookupType('stan.WriterMessage');
  return stan_protobuf;
}
async function start_worker(model, fit, data, options, operation) {
  fit.fit_file = join('models', model.id, `${fit.fit_id}.dat`);
  const encoder = await get_protobuf_writer();
  const writer = protobuf.Writer.create();
  const thread = new workers.Worker(cache.file('models', model.id, 'model.js'));
  thread.on('message', (msg) => {
    switch (msg.info) {
    case 'ready':
      thread.postMessage({
        cmd: 'hmc_nuts_diag_e_adapt',
        data: data,
        args: {
          ...sampler_default_args,
          ...options
        }
      });
      break;
    case 'hmc_nuts-msg':
      encoder.encodeDelimited(
        encoder.create(msg.msg),
        writer
      );
      if (msg.msg.topic === 1) {
        const info = msg.msg.feature[0].stringList.value[0];
        if (info.startsWith('Iteration'))
          operation.metadata.progress = info;
      }      break;
    case 'hmc_nuts-done':
      fs.writeFile(cache.file(fit.fit_file), writer.finish(), () => {
        thread.terminate();
        cache.store_fit(fit);
        operation.done = true;
        if (msg.error)
          operation.result = { code: 400, message: msg.error };
        else
          operation.result = { name: fit.fit_name };
      });
      break;
    case 'debug':
      console.log(msg.msg);
      break;
    }
  });
}

