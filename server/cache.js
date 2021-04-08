'use strict';

const fs = require('fs');
const { dirname, join } = require('path');

const cache_dir = join(dirname(__dirname), 'v1');
exports.cache_dir = cache_dir;

exports.file = file;
function file(...path) {
  return join(cache_dir, ...path);
}

const all_models = new Map();
const all_fits = new Map();
const all_ops = new Map();

exports.setup = setup;
function setup() {
  return new Promise((resolve, reject) => {
  fs.readFile(join(cache_dir, 'models.json'), {encoding: 'utf8'},
    (err, data) => {
      if (err)
        reject(err);
      else try {
        const { models } = JSON.parse(data);
        for (let model of models) {
          let [prefix, model_id] = model.name.split('/');
          store_model(model_id, model);
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

exports.list_models = list_models;
function list_models() {
  return { models: Array.from(all_models.values()) };
}

exports.write_models = write_models;
function write_models() {
  return new Promise((resolve, reject) => {
  fs.writeFile(join(cache_dir, 'models.json'),
    JSON.stringify(list_models()),
    (err) => err ? reject(err) : resolve()
    );
  });
}

exports.lookup_model = lookup_model;
function lookup_model(model_id) {
  return all_models.get(model_id);
}

exports.store_model = store_model;
function store_model(model_id, model) {
  all_models.set(model_id, model);
}

exports.delete_model = delete_model;
function delete_model(model_id) {
  // FIXME delete files too
  let del_fits = [];
  for (let [fit_id, fit] of all_fits)
    if (fit.model_id === model_id)
      del_fits.push(fit_id);
  for (let fit_id of del_fits)
    delete_fit(fit_id);
  return all_models.delete(model_id);
}

exports.lookup_fit = lookup_fit;
function lookup_fit(fit_id) {
  return all_fits.get(fit_id);
}

exports.store_fit = store_fit;
function store_fit(fit) {
  all_fits.set(fit.fit_id, fit);
}

exports.delete_fit = delete_fit;
function delete_fit(fit_id) {
  // FIXME delete files
  for (let [op_id, op] of all_ops)
    if (op.metadata.fit_id === fit_id)
      op.cancelled = true;
  return all_fits.delete(fit_id);
}

exports.lookup_operation = lookup_operation;
function lookup_operation(op_id) {
  return all_ops.get(op_id);
}

exports.store_operation = store_operation;
function store_operation(op_id, operation) {
  all_ops.set(op_id, operation);
}
