import { make_list, task_monitor, data_input, options } from './common.js';
import { histogram } from './visual.js';

export
async function create_fit(elt, model, settings) {
  const div = elt.append('div');
  const get_data = data_input(div);
  const get_options = await options(div);
  const client_fit = div.append('button').text('Fit in browser');
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
        const payload = { data: data };
        if (settings.random)
          payload.random_seed = options.random_seed;
        const params = await settings.fetch(
          `${model.name}/params`, 200, payload);
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
      let draws = undefined;
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
        case 'update':
          draws(event.data.payload);
          break;
        case 'done':
          if (draws === undefined) {
            // get_params task complete
            draws = fit_data(event.data.payload, monitor.update);
            worker.postMessage({
              cmd: 'hmc_nuts_diag_e_adapt',
              data: data,
              args: options
            });
          } else {
            // sampling complete
            resolve(draws.view);
          }
          break;
        case 'error':
          reject(new Error(event.data.payload));
          break;
        case 'debug':
          console.log(event.data.payload);
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

async function load_fit(fit_name, params, settings) {
  const stream = await fetch(new URL(fit_name, settings.url));
  if (!stream.ok)
    throw new Error(stream.status);
  const buffer = await stream.text();
  const data = fit_data(params);
  for (let msg of buffer.split('\n'))
    if (msg)
      data(JSON.parse(msg));
  return data.view;
}

function fit_data(params, update) {
  const samples = {};
  const msgs = [];
  function append(msg) {
    switch (msg.topic) {
    case 'logger':
      for (let s of msg.values)
        if (!s.startsWith('info:Iteration: '))
          msgs.push(s);
        else if (update)
          update(...parse_progress(s.slice(5)));
      break;
    case 'initialization':
      break;
    case 'sample':
      if (msg.values instanceof Array)
        for (let s of msg.values)
          msgs.push(s);
      else
        for (let name in msg.values) {
          if (!(name in samples))
            samples[name] = [];
          samples[name].push(msg.values[name]);
        }
      break;
    case 'diagnostic':
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
