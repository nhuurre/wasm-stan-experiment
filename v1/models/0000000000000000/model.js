const Module = {};

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
    nuts_sample_diag_e_adapt(msg.data, msg.args);
    sendMessage({
      info: 'hmc_nuts-done',
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
  return [{
    name: 'x',
    dims: [],
    constrained_names: ['x']
  }];
}

function nuts_sample_diag_e_adapt(data, args) {
  const logger = new MsgWriter(1);
  const samples = new MsgWriter(3);
  samples.write_names(['lp__', 'x']);

  for (let i = 0; i < args.num_samples; i++) {
    if (args.refresh > 0 && i % args.refresh === 0)
      logger.write_message(`Iteration: ${i} / ${args.num_samples} (Sampling)`);
    if (i % args.num_thin == 0) {
      const x = normal_sample(0,1);
      samples.begin_array(2);
      samples.append_double(-0.5*x*x);
      samples.append_double(x);
      samples.finish_array();
    }
  }
}

function normal_sample(m, s) {
  let x, y, r;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    r = Math.hypot(x, y);
  } while (r >= 1.0)
  return m + s * (x/r) * Math.sqrt(-2 * Math.log(r));
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

Module.onRuntimeInitialized();
