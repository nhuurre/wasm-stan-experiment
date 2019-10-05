let sendMessage = (msg) => void console.log(`IGNORED: ${msg.msg}`);
Module.print = (text) => void sendMessage({info:'debug', msg:text});
Module.printErr = (text) => void sendMessage({info:'debug',msg:text});
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
  switch (msg.cmd) {
  case 'hmc_nuts_diag_e_adapt':
    const err = nuts_sample_diag_e_adapt(msg.data, msg.args);
    sendMessage({
      info: 'hmc_nuts-done',
      error: err
    });
    break;
  case 'get_params':
    try {
      sendMessage({info:'params', params: get_params(msg.data, msg.random_seed)});
    } catch (err) {
      sendMessage({info:'params-err', msg: err.message});
    }
    break;
  default:
    sendMessage({info:'debug',msg:`bad command ${msg.cmd}`});
  }
}

function get_params(file, random_seed) {
  const is_blob = (file.constructor !== Object)
  FS.mkdir('/data');
  if (is_blob) {
    FS.mount(WORKERFS, {blobs: [{name: 'data.json', data: file}]}, '/data');    
  } else {
    FS.writeFile('/data/data.json', JSON.stringify(file));
  }
  const failcode = Module._get_params(random_seed);
  if (is_blob) {
    FS.unmount('/data');
  } else {
    FS.unlink('/data/data.json');
  }
  FS.rmdir('/data');
  if (failcode) {
    const msg = FS.readFile('/errors.txt', {encoding: 'utf8'});
    FS.unlink('/errors.txt');
    throw new Error(msg);
  }
  const info = FS.readFile('/params.json', {encoding: 'utf8'});
  FS.unlink('/params.json');
  const {
    names,
    dims,
    constrained_names
  } = JSON.parse(info);
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

function nuts_sample_diag_e_adapt(data, args) {
  const is_blob = (data.constructor !== Object);
  FS.mkdir('/data');
  if (is_blob) {
    FS.mount(WORKERFS, {blobs: [{name: 'data.json', data: data}]}, '/data');    
  } else {
    FS.writeFile('/data/data.json', JSON.stringify(data));
  }
  for (let i of [1,2,3,4])
    live_writers.set(i, new MsgWriter(i));
  const failcode = Module._hmc_nuts_diag_e_adapt_sample(
    args.random_seed, args.chain, args.init_radius,
    args.num_warmup, args.num_samples, args.num_thin, args.save_warmup,
    args.refresh, args.stepsize, args.stepsize_jitter, args.max_depth,
    args.delta, args.gamma, args.kappa, args.t0,
    args.init_buffer, args.term_buffer, args.window
  );
  if (is_blob) {
    FS.unmount('/data');
  } else {
    FS.unlink('/data/data.json');
  }
  FS.rmdir('/data');
  if (failcode) {
    const msg = FS.readFile('/errors.txt', {encoding: 'utf8'});
    FS.unlink('/errors.txt');
    return msg;
  }
}

class MsgWriter {
  constructor(topic) {
    this.topic = topic;
    this.item_names = null;
  }
  write_message(msg) {
    sendMessage({
      info: 'hmc_nuts-msg',
      msg: {
        topic: this.topic,
        feature: [{stringList: {value: [msg]}}]
      }
    });
  }
  write_names(names) {
    this.item_names = names;
  }
  write_array(arr) {
    let a = Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      a[i] = {name: this.item_names[i], doubleList: {value: [arr[i]]}};
    }
    sendMessage({
      info: 'hmc_nuts-msg',
      msg: {
        topic: this.topic,
        feature: a
      }
    });
  }
  begin_array(n) {
    this.active = Array(n);
    this.idx = 0;
  }
  append_double(d) {
    // item_names === null if this is the init writer
    this.active[this.idx] = {
      name: this.item_names ? this.item_names[this.idx] : undefined,
      doubleList: {value: [d]}
    };
    this.idx += 1;
  }
  append_name(n) {
    this.active[this.idx] = n;
    this.idx += 1;
  }
  finish_array() {
    sendMessage({
      info: 'hmc_nuts-msg',
      msg: {
        topic: this.topic,
        feature: this.active
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
const live_writers = new Map();
