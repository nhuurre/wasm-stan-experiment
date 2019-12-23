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
  fs.readFile(join(cache_dir, 'list-models'), {encoding: 'utf8'},
    (err, data) => {
      if (err)
        reject(err);
      else try {
        data = JSON.parse(data);
        for (let model of data)
          store_model(model.id, model);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

exports.list_models = list_models;
function list_models() {
  return Array.from(all_models.values());
}

exports.write_models = write_models;
function write_models() {
  return new Promise((resolve, reject) => {
  fs.writeFile(join(cache_dir, 'list-models'),
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

exports.lookup_fit = lookup_fit;
function lookup_fit(fit_id) {
  return all_fits.get(fit_id);
}

exports.store_fit = store_fit;
function store_fit(fit) {
  all_fits.set(fit.fit_id, fit);
}

exports.lookup_operation = lookup_operation;
function lookup_operation(op_id) {
  return all_ops.get(op_id);
}

exports.store_operation = store_operation;
function store_operation(op_id, operation) {
  all_ops.set(op_id, operation);
}
