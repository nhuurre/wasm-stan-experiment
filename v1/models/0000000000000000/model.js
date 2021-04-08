const live_writers = new Map();
const global_data = {};
if (Module === undefined) {
  // No WASM, just for testing
  var Module = {
    fake_module_test_model: true,
    _get_params: (random_seed) => {
      FS.writeFile('/output.json', JSON.stringify(
        {names: ['x'], dims: [], constrained_names: ['x']}));
      return 0;
    },
    _get_transform_inits: (random_seed) => {
      return 0;
    },
    _do_function: (num_param, func, adjust_transform,
                   include_tparams, include_gqs, random_seed) => {
      switch (func) {
      case 1: // log_prob
        global_data.out_params.push(0.0);
        break;
      case 2: // log_prob_grad
        break;
      case 3: // write_array
        if (include_gqs)
          global_data.out_params.push(normal_sample(0,1));
        break;
      }
      return 0;
    },
    _mcmc_sample: (is_fixed_sampler, seed, chain, init_r,
                   warmup, samples, thin, save_warmup,
                   refresh, ...options) => {
      live_writers.get(3).begin_array(2);
      live_writers.get(3).append_name('lp__');
      live_writers.get(3).append_name('x');
      live_writers.get(3).finish_names();
      for (let i = 0; i < samples; i++) {
        if (refresh > 0 && i % refresh === 0)
          live_writers.get(1).write_message(2,
          `Iteration: ${i} / ${samples} (Sampling)`);
        if (i % thin == 0) {
          const x = normal_sample(0,1);
          live_writers.get(3).begin_array(2);
          live_writers.get(3).append_double(-0.5*x*x);
          live_writers.get(3).append_double(x);
          live_writers.get(3).finish_array();
        }
      }
      return 0;
    },
  };
  var FS = {
    _data: {},
    mkdir: () => {}, rmdir: () => {},
    mount: () => {}, unmount: () => {},
    writeFile: (name, data) => { FS._data[name] = data; },
    readFile: (name) => FS._data[name],
    unlink: () => {}
  };
  function normal_sample(m, s) {
    let x, y, r;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      r = Math.hypot(x, y);
    } while (r >= 1.0)
    return m + s * (x/r) * Math.sqrt(-2 * Math.log(r));
  }
}

let sendMessage = (msg) => void console.log(`IGNORED: ${msg.payload}`);
Module.print = (text) => void sendMessage({info:'debug', payload: text});
Module.printErr = (text) => void sendMessage({info:'debug', payload: text});
Module.onRuntimeInitialized = () => {
  if (this.constructor !== Object) {
    // Web browser
    this.onmessage = (event) => handle_message(event.data);
    sendMessage = (msg) => postMessage(msg);
  } else {
    // NodeJS
    const { parentPort } = require('worker_threads');
    parentPort.on('message', (msg) => handle_message(msg));
    sendMessage = (msg) => parentPort.postMessage(msg);
  }
  sendMessage({info: 'ready'});
};

function handle_message(msg) {
  try {
    sendMessage({
      info: 'done',
      payload: dispatch(msg)
    });
  } catch (err) {
    sendMessage({
      info: 'error',
      payload: err.message
    });
  }
}

function dispatch(msg) {
  switch (msg.cmd) {
  case 'fixed_param':
    return run_sampler(true, msg.data, msg.args);
  case 'hmc_nuts_diag_e_adapt':
    return run_sampler(false, msg.data, msg.args);
  case 'get_params':
    return get_params(msg.data, msg.random_seed);
  case "log_prob":
    return do_function(1, msg.data, msg.unconstrained_parameters, msg.adjust_transform, true, true, msg.random_seed)[0];
  case "log_prob_grad":
    return do_function(2, msg.data, msg.unconstrained_parameters, msg.adjust_transform, true, true, msg.random_seed);
  case "write_array":
    return do_function(3, msg.data, msg.unconstrained_parameters, true, msg.include_tparams, msg.include_gqs, msg.random_seed);
  case "transform_inits":
    return do_transform_inits(msg.data, msg.constrained_parameters, msg.random_seed);
  default:
    throw new Error(`Unknown command ${msg.cmd}`);
  }
}

function with_cleanup(func, cleanup, ...args) {
  let value;
  try {
    value = func(...args);
    cleanup();
    return value;
  } catch (err) {
    cleanup();
    throw err;
  }
}

function with_data(data, func, ...args) {
  if (data === undefined)
    data = {};
  const is_blob = false;//(data.constructor !== Object)
  FS.mkdir('/data');
  if (is_blob)
    FS.mount(WORKERFS, {blobs: [{name: 'data.json', data: data}]}, '/data');    
  else
    FS.writeFile('/data/data.json', JSON.stringify(data));
  return with_cleanup(func, () => {
    if (is_blob)
      FS.unmount('/data');
    else
      FS.unlink('/data/data.json');
    FS.rmdir('/data');
  }, ...args);
}

function with_params(params, func, ...args) {
  FS.writeFile('/params.json', JSON.stringify(params));
  return with_cleanup(func, () => {
    FS.unlink('/params.json');
  }, ...args);
}

function error_code(func, ...args) {
  if (func(...args)) {
    const msg = FS.readFile('/errors.txt', {encoding: 'utf8'});
    FS.unlink('/errors.txt');
    throw new Error(msg);
  }
}

function output_file(func, ...args) {
  error_code(func, ...args);
  const output = FS.readFile('/output.json', {encoding: 'utf8'});
  FS.unlink('/output.json');
  return JSON.parse(output);
}

function array_output(func, ...args) {
  global_data.out_params = [];
  error_code(func, ...args);
  return global_data.out_params;
}

function array_transform(func, arr, ...args) {
  global_data.in_params = arr;
  global_data.out_params = [];
  error_code(func, arr.length, ...args);
  return global_data.out_params;
}

function get_params(file, random_seed) {
  const {
    names,
    dims,
    constrained_names
  } = with_data(file, () =>
        output_file(Module._get_params, random_seed));
  const list = [];
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    const d = dims[i];
    const c = [];
    for (let cn of constrained_names)
      if (cn === n || cn.startsWith(n+'.'))
        c.push(cn);
    list.push({
      name: n,
      dims: d,
      constrained_names: c
    });
  }
  return list;
}

function do_transform_inits(data, constrained_parameters, random_seed) {
  return with_data(data, () =>
    with_params(constrained_parameters, () =>
      array_output(Module._get_transform_inits, random_seed)));
}

function do_function(func, data, flat_params, adjust_transform,
                     include_tparams, include_gqs, random_seed) {
  return with_data(data, () =>
    array_transform(Module._do_function, flat_params, func,
      adjust_transform, include_tparams, include_gqs, random_seed));
}

function run_sampler(is_fixed_sampler, data, args) {
  live_writers.set(1, new MsgWriter('logger'));
  live_writers.set(2, new MsgWriter('initialization'));
  live_writers.set(3, new MsgWriter('sample'));
  live_writers.set(4, new MsgWriter('diagnostic'));
  with_data(data, () =>
    with_params(args.init !== undefined ? args.init : {}, () =>
      error_code(Module._mcmc_sample, is_fixed_sampler,
        args.random_seed, args.chain, args.init_radius,
        args.num_warmup, args.num_samples, args.num_thin, args.save_warmup,
        args.refresh, args.stepsize, args.stepsize_jitter, args.max_depth,
        args.delta, args.gamma, args.kappa, args.t0,
        args.init_buffer, args.term_buffer, args.window)));
  return;
}

const prefixes = ['', 'debug:', 'info:', 'warn:', 'error:', 'fatal:'];
class MsgWriter {
  constructor(topic) {
    this.topic = topic;
    this.item_names = null;
  }
  write_message(prefix, msg) {
    sendMessage({
      info: 'update',
      payload: {
        topic: this.topic,
        values: [prefixes[prefix] + msg]
      }
    });
  }
  write_names(names) {
    this.item_names = names;
  }
  begin_array(n) {
    this.active = {};
    this.idx = 0;
  }
  append_double(d) {
    // item_names === null if this is the init writer
    if (this.item_names)
      this.active[this.item_names[this.idx]] = d;
    this.idx += 1;
  }
  append_name(n) {
    this.active[this.idx] = n;
    this.idx += 1;
  }
  finish_array() {
    sendMessage({
      info: 'update',
      payload: {
        topic: this.topic,
        values: this.active
      }
    });
    this.active = null;
    this.idx = 0;
  }
  finish_names() {
    this.write_names(this.active);
    this.active = null;
    this.idx = 0;
  }
}

if (Module.fake_module_test_model)
  Module.onRuntimeInitialized();

