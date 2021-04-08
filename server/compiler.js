'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const { join } = require('path');
const { createHash } = require('crypto');

const cache = require('./cache.js');

const stanjslib = join(__dirname, 'stanlib.js');
const worker_cpp = join(__dirname, 'worker.cpp');

const cmdstan_dir = process.env['CMDSTAN_PATH'];
if (!cmdstan_dir)
  throw new Error('CmdStan not found -- please set CMDSTAN_PATH environment variable');

const stanc_exe = join(cmdstan_dir, 'bin', 'stanc');
const emcc_exe = 'em++';

const stan_macros = [
  '-D', '_REENTRANT',
  '-D', 'BOOST_DISABLE_ASSERTS',
  '-D', 'BOOST_PHOENIX_NO_VARIADIC_EXPRESSION'
];

const stan_math = join(cmdstan_dir, 'stan', 'lib', 'stan_math');
const stan_libs = [
  '-I', join(__dirname, 'shim'),
  '-I', join(cmdstan_dir, 'src'),
  '-I', join(cmdstan_dir, 'lib', 'rapidjson_1.1.0'),
  '-I', join(cmdstan_dir, 'stan', 'src'),
  '-I', stan_math,
  '-I', join(stan_math, 'lib', 'eigen_3.3.9'),
  '-I', join(stan_math, 'lib', 'boost_1.72.0'),
  '-I', join(stan_math, 'lib', 'sundials_5.6.1', 'include')
];

const version = {
  server: 'nodejs-stan 0.3'
};
exports.setup = setup;
async function setup() {
  version.stanc = await run_process(stanc_exe, ['--version']).then(({out}) => out);
  version.emcc = await run_process(emcc_exe, ['--version']).then(({out}) => out);
}
exports.version_info = version_info;
async function version_info() {
  return (version.server + version.stanc + version.emcc);
}

exports.calculate_model_id = calculate_model_id;
function calculate_model_id(source) {
  const hash = createHash('blake2b512');
  hash.update(source);
  hash.update(version.server);
  hash.update(version.stanc);
  hash.update(version.emcc);
  return hash.digest('hex').slice(0,16);
}

function run_process(exe, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, args);
    proc.on('error', reject);
    const output = [];
    const errors = [];
    proc.stdout.on('data', (data) => output.push(data));
    proc.stderr.on('data', (data) => errors.push(data));
    proc.on('close', (exitcode) => {
      if (exitcode) reject(new Error(errors.join('')));
      else resolve({out: output.join(''), err: errors.join('')});
    });
  });
}

function run_stanc(source, model_id, model) {
  return new Promise((resolve, reject) => {
    const stan_path = cache.file('models', model_id, 'model.stan')
    const hpp_path = cache.file('models', model_id, 'model.hpp')
    fs.writeFile(stan_path, source, (err) => {
      if (err) {
        reject(err);
      } else {
        const args = [
          stan_path,
          `--o=${hpp_path}`
        ];
        run_process(stanc_exe, args).then(({err}) => {
          model.stanc_warnings = err;
          resolve(hpp_path);
        }).catch(reject);
      }
    });
  });
}

function run_emcc(model_id, model, hpp_file) {
  const args = [
    '-std=c++1y',
    '-O3',
    ...stan_macros,
    ...stan_libs,
    '-s', 'DISABLE_EXCEPTION_CATCHING=0',
    '--js-library', stanjslib,
    '--pre-js', cache.file('models/0000000000000000/model.js'),
    '-include', hpp_file,
    worker_cpp,
    '-o', cache.file('models', model_id, 'model.js'),
  ];
  return run_process(emcc_exe, args).then(({out}) => out);
}

function create_dir(...path) {
  return new Promise((resolve, reject) => {
    path = join(...path);
    fs.access(path, (err) => {
      if (!err)
        resolve(path);
      else
        fs.mkdir(path, {recursive: true},
        (err) => {
          if (err) reject(err);
          else resolve(path);
        });
    });
  });  
}

async function compile_task(source, model_id, model) {
  await create_dir(cache.cache_dir, 'models', model_id);
  const hpp_file = await run_stanc(source, model_id, model);
  model.compiler_output = await run_emcc(model_id, model, hpp_file);
  cache.store_model(model_id, model);
  await cache.write_models().catch(
    (err) => void console.error(err));
  compiling_tasks.delete(model_id);
  return model;
}

const compiling_tasks = new Map();

exports.compile_model = compile_model;
function compile_model(source) {
  const model_id = calculate_model_id(source);
  const model = cache.lookup_model(model_id);
  if (model)
    return Promise.resolve(model);
  let task = compiling_tasks.get(model_id);
  if (!task) {
    const model = {
      name: `models/${model_id}`
    };
    task = compile_task(source, model_id, model);
    compiling_tasks.set(model_id, task);
  }
  return task;
}

