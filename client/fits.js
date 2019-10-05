import { make_list, task_monitor, data_input, options } from './common.js';
import { histogram } from './visual.js';

export
async function create_fit(elt, model, settings) {
  const div = elt.append('div');
  const get_data = data_input(div);
  const get_options = await options(div);
  const client_fit = div.append('button').text('Fit locally');
  const server_fit = div.append('button').text('Fit on server');
  elt.append('h3').text('Fits');
  const new_item = make_list(elt);
  if (!settings.wasm) {
    client_fit.attr('title', 'The server does not provide WebAssembly.');
    client_fit.node().disabled = true;
  } else {
    client_fit.attr('title', 'Create a new fit in a WebWorker.');
    client_fit.node().onclick = async() => {
      const data = await get_data();
      if (!data)
        return;
      const options = get_options();
      const item = new_item();
      workertask(item, model, data, options, settings);
    };
  }
  if (!settings.fit) {
    server_fit.attr('title','The server does not support making new fits.');
    server_fit.node().disabled = true;
  } else {
    server_fit.attr('title','Create a new fit through HttpStan.');
    server_fit.node().onclick = async() => {
      const data = await get_data();
      if (data === undefined)
        return;
      const options = get_options();
      const item = new_item();
      item.append('div')
          .classed('delbox', true)
          .text('X')
          .attr('title', 'delete fit')
          .node()
          .onclick = ()=>void item.remove();
      const monitor = task_monitor(item);
      const fitview = await monitor(async() => {
        const params = await settings.fetch(
          `${model.name}/params`, 200,
          { data: data, random_seed: options.random_seed }
        );
        const operation = await settings.fetch(
          `${model.name}/fits`, 201, {
          'function': 'stan::services::sample::hmc_nuts_diag_e_adapt',
          'data': data,
          ...options
        });
        const info = await httpstan_task(operation, monitor.update, settings);
        if (info.name)
          return await load_fit(info.name, params, settings);
        else
          return (elt) => void elt.append('span').text(info.message);
      }, true);
      if (fitview) {
        monitor.remove();
        fitview(item);
      }
    };
  }
}

export
async function workertask(elt, model, data, options, settings) {
  elt.append('div')
     .classed('delbox', true)
     .text('X')
     .attr('title', 'delete fit')
     .node()
     .onclick = ()=>void elt.remove();
  const monitor = task_monitor(elt);
  const fitview = await monitor(async() => {
    const worker = new Worker(new URL(`${model.name}/model.js`, settings.url));
    try {
      return await new Promise((resolve, reject) => {
      let draws;
      worker.onerror = (event) => {
        reject(new Error(event.message));
      };
      worker.onmessage = (event) => {
        switch (event.data.info) {
        case 'ready':
          worker.postMessage({
            cmd: 'get_params',
            data: data,
            random_seed: options.random_seed
          });
          break;
        case 'params':
          draws = fit_data(event.data.params, monitor.update);
          worker.postMessage({
            cmd: 'hmc_nuts_diag_e_adapt',
            data: data,
            args: options
          });
          break;
        case 'params-err':
          reject(new Error(event.data.msg));
          break;
        case 'hmc_nuts-msg':
          draws(event.data.msg);
          break;
        case 'hmc_nuts-done':
          resolve(draws.view);
          break;
        case 'debug':
          console.log(event.data.msg);
          break;
        }
      };
    });
  } finally {
    setTimeout(()=>void worker.terminate(), 0);
  }
  }, true);
  if (fitview) {
    monitor.remove();
    fitview(elt);
  }
}

function httpstan_task(operation, update, settings) {
  if (operation.done)
    return Promise.resolve(operation.result);
  return new Promise((resolve, reject) => {
    const interval = setInterval(async() => {
      try {
        operation = await settings.fetch(operation.name);
      } catch (error) {
        clearInterval(interval);
        reject(error);
      }
      if (operation.done) {
        clearInterval(interval);
        resolve(operation.result);
      } else if (update) {
        const progress = parse_progress(operation.metadata.progress);
        if (progress)
          update(...progress);
      }
    }, 1000);
  });
}

function parse_progress(message) {
  if (!message || !message.startsWith('Iteration: '))
    return;
  let [val, max] = message.split('/');
  val = val.trim().split(' ').reverse()[0];
  max = max.trim().split(' ')[0];
  return [val, max];
}

let stan_protobuf;
async function get_protobuf_writer() {
  if (stan_protobuf)
    return stan_protobuf;
  const namespace = await protobuf.load(
    new URL('./callbacks_writer.proto', import.meta.url).pathname);
  stan_protobuf = namespace.lookupType('stan.WriterMessage');
  return stan_protobuf;
}

async function load_fit(fit_name, params, settings) {
  const stream = await fetch(new URL(fit_name, settings.url));
  if (!stream.ok)
    throw new Error(stream.status);
  const buffer = await stream.arrayBuffer();
  const decoder = await get_protobuf_writer();
  const reader = new protobuf.Reader(new Uint8Array(buffer));
  const data = fit_data(params);
  while (reader.pos < reader.len) {
    const msg = decoder.decodeDelimited(reader);
    data(msg);
  }
  return data.view;
}

function fit_data(params, update) {
  const samples = {};
  const msgs = [];
  let count_msg = 0;
  function append(msg) {
    switch (msg.topic) {
    case 1: // LOGGER
      for (let f of msg.feature)
        for (let s of f.stringList.value)
          if (!s.startsWith('Iteration: '))
            msgs.push(s);
          else if (update)
            update(...parse_progress(s));
      break;
    case 2: // INITIALIZE
      break;
    case 3: // SAMPLE
      count_msg += 1;
      for (let f of msg.feature) if (f.name) {
        if (!(f.name in samples))
          samples[f.name] = [];
        samples[f.name].push(f.doubleList.value[0]);
      }
      break;
    case 4: // DIAGNOSTIC
      break;
    }
  }
  append.view = (elt) => {
    const log = elt.append('details');
    log.append('summary').text('Logger messages');
    log.append('textarea')
       .attr('readonly', 'readonly')
       .attr('rows', msgs.length+1)
       .attr('cols', '80')
       .node()
       .value = msgs.join('\n');
    elt = elt.append('div').classed('fit-info', true);
    const list = elt.append('ol').classed('fit-params', true);
    const box =
      elt.append('div')
         .classed('fit-box', true);
    const info =
      box.append('div');
    const display =
      box.append('svg')
         .attr('height', '30em')
         .attr('viewBox','0 0 400 400');
    let count = 0;
    for (let s in samples)
      if (count > 50) {
        // what to do when model has hundreds of parameters?
        list.append('li').text('...');
        break;
      } else {
        count += 1;
        const li =
          list.append('li')
              .text(s);
        li.node()
          .onclick = () => {
        const draws = samples[s];
        let m = d3.mean(draws);
        let d = d3.deviation(draws);
        // XXX there must be some d3 idiom for doing this properly
        let x = Math.max(Math.abs(m), d);
        if (x > 0 && 1/x > 0) {
          x = Math.pow(10,Math.floor(Math.log10(x))-3);
          m = Math.round(m/x)*x;
          d = Math.round(d/x)*x;
        }
        info.text(`${s}: ${d3.format('.4~g')(m)}±${d3.format('.4~g')(d)} (${draws.length} draws)`);
        display.select("g").remove();
        const g = display.append('g');
        histogram(g, draws, {
          left: 30, right: 20,
          top: 20, bottom: 30,
          width: 400, height: 400,
        });
        };
        if (s === 'lp__')
          li.node().onclick();
      }
    if (count === 0)
      elt.text('Fit contains no samples!');
  };
  return append;
}
