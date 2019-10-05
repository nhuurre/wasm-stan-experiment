import { make_list, task_monitor, options, data_input } from './common.js';
import { create_fit, workertask } from './fits.js';

export
function compiler(elt, settings) {
  elt.append('h2').text('Compile Stan code');
  const area =
    elt.append('textarea')
       .attr('rows', '20')
       .attr('cols', '80');
  area.node()
      .value = 'parameters {\n real x;\n} model {\n x ~ std_normal();\n}';
  const button = elt.append('div').append('button').text('Compile');
  const monitor = task_monitor(elt);
  elt.append('h3').text('Models');
  const new_item = make_list(elt);
  button.node().onclick = async() => {
    button.node().disabled = true;
    const source = area.node().value;
    await monitor(async() => {
      const model = await settings.fetch(
        'models', 201,
        { program_code: source }
      );
      modelview(new_item(), model, settings, source);
    }, true);
    button.node().disabled = false;
  };
  area.node().oninput = monitor.stale;
}

export
async function model_list(elt, settings) {
  const models = await settings.fetch('list-models');
  if (models.length === 0) {
    elt.append('div').text('No models found.');
    return;
  }
  const new_item = make_list(elt);
  for (let model of models) {
    if (model.name === "models/e0033a28167e65a1")
      await binomial_model(new_item(), model, settings)
    else if (model.name === "models/f735856115d01251")
      await linear_model(new_item(), model, settings)
    else
      await modelview(new_item(), model, settings);
  }
}


function sourceview(elt, model_name, settings, source) {
  elt = elt.append('details');
  elt.append('summary').text('source');
  if (source) {
    elt.append('pre').append('code').text(source);
  } else {
    const progress = elt.append('progress');
    const retrieve = async() => {
      try {
        const response = await fetch(new URL(`${model_name}/model.stan`, settings.url));
        if (!response.ok)
          throw new Error(response.statusText);
        source = await response.text();
        progress.remove();
        elt.append('pre').append('code').text(source);
      } catch (error) {
        elt.text(error.message);
      }
      elt.node().removeEventListener('toggle', retrieve);
    };
    elt.node().addEventListener('toggle', retrieve);
  }
  return elt;
}

export
async function modelview(elt, info, settings, source) {
  const model_name = info.name;
  const compiler_output = info.compiler_output;
  elt.append('h3').text(`Model ${model_name}`);
  sourceview(elt, model_name, settings, source);
  create_fit(elt, info, settings);
}

function binomial_sample(n, p) {
  let k = 0;
  for (let i = 0; i < n; i++)
    k += (Math.random() < p);
  return k;
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

function getindex(arr, fst, ...idx) {
  if (fst === undefined)
    fst = 0;
  if (arr instanceof Array)
    return getindex(arr[fst], idx);
  else if (fst == 0)
    return arr;
}

/*
data {
  int<lower=0> N;
  int<lower=0> P;
  int<lower=0> n[N];
  int<lower=0> k[N];
  matrix[N,P] x;
} parameters {
  real intercept;
  vector[P] beta;
} model {
  intercept ~ logistic(0, 1);
  beta ~ std_normal();
  k ~ binomial_logit(n, intercept + x * beta);
} generated quantities {
  real intercept_prob = inv_logit(intercept);
}
*/
async function binomial_model(elt, info, settings) {
  const model_name = info.name;
  elt.append('h3').text(`Logistic regression (${model_name})`);
  sourceview(elt, model_name, settings);

  const sim = elt.append('button').text('Simulate data');
  elt.append('br');
  const data = data_input(elt);
  async function read_data() {
    const d = await data();
    if (d === undefined)
      return;
    // fill in defaults
    if (d.N === undefined)
      for (let a of [d.k, d.n, d.x, {length:0}])
        if (a !== undefined) {
          d.N = a.length;
          break;
        }
    else
      d.N = getindex(d.N);
    if (d.P === undefined)
      if (d.x !== undefined && d.x.length > 0)
        d.P = d.x[0].length;
      else
        d.P = 0;
    else
      d.P = getindex(d.P);
    if (d.n === undefined)
      if (d.k === undefined || d3.max(d.k) <= 1) {
        d.n = Array(d.N);
        for (let i = 0; i < d.N; i++)
          d.n[i] = 1;
      }
    return d;
  }
  sim.node().onclick = async() => {
    const d = await read_data();
    if (d === undefined)
      return;
    if (d.N === 0)
      d.N = 10;
    if (d.P === 0) {
      d.P = 1;
    }
    if (d.n === undefined || d.n.length !== d.N) {
      d.n = Array(d.N);
      for (let j = 0; j < d.N; j++)
        d.n[j] = 1;
    }
    if (d.x === undefined || d.x.length !== d.N) {
      d.x = Array(d.N);
      for (let j = 0; j < d.N;j++) {
        d.x[j] = Array(d.P);
        for (let i = 0; i < d.P; i++)
          d.x[j][i] = normal_sample(0,1);
      }
    }
    const intercept = Math.log(-1+1/Math.random());
    const beta = Array(d.P);
    for (let i = 0; i < d.P; i++)
      beta[i] = normal_sample(0,1);
    d.k = Array(d.N);
    for (let j = 0; j < d.N; j++) {
      let p = intercept;
      for (let i = 0; i < d.P; i++)
        p += beta[i]*getindex(d.x, j, i);
      d.k[j] = binomial_sample(getindex(d.n, j), 1/(1+Math.exp(-p)));
    }
    data.setdata(d, true);
  };

  const getoptions = await options(elt);
  const create_fit = elt.append('button').text('Create fit');
  elt.append('h3').text('Fits');
  const new_item = make_list(elt);

  create_fit.node().onclick = async() => {
      const d = await read_data();
      if (d === undefined)
        return;
      const opts = getoptions();
      const item = new_item();
      workertask(item, info, d, opts, settings);
  };
}

/*
data {
  int<lower=3> N;
  int<lower=0> P;
  matrix[N,P] x;
  vector[N] y;
} parameters {
  real intercept;
  vector[P] beta;
  real<lower=0> sigma;
} model {
  beta ~ std_normal();
  y ~ normal(intercept + x*beta, sigma);
}
*/
async function linear_model(elt, info, settings) {
  const model_name = info.name;
  elt.append('h3').text(`Linear regression (${model_name})`);
  sourceview(elt, model_name, settings);

  const sim = elt.append('button').text('Simulate data');
  elt.append('br');
  const data = data_input(elt);
  sim.node().onclick = async() => {
    const d = await data();
    if (d === undefined)
      return;
    if (!d.N)
      d.N = 10;
    if (!d.P) {
      d.P = 1;
    }
    if (d.x === undefined || d.x.length !== d.N || d.x[0].length !== d.P) {
      d.x = Array(d.N);
      for (let j = 0; j < d.N;j++) {
        d.x[j] = Array(d.P);
        for (let i = 0; i < d.P; i++)
          d.x[j][i] = normal_sample(0,1);
      }
    }
    const intercept = normal_sample(10,5);
    const sigma = -Math.log(Math.random());
    const beta = Array(d.P);
    for (let i = 0; i < d.P; i++)
      beta[i] = normal_sample(0,1);
    d.y = Array(d.N);
    for (let j = 0; j < d.N; j++) {
      let y = intercept;
      for (let i = 0; i < d.P; i++)
        y += beta[i]*getindex(d.x, j, i);
      d.y[j] = normal_sample(y, sigma);
    }
    data.setdata(d, true);
  };

  const getoptions = await options(elt);
  const create_fit = elt.append('button').text('Create fit');
  elt.append('h3').text('Fits');
  const new_item = make_list(elt);

  create_fit.node().onclick = async() => {
      const d = await data();
      if (d === undefined)
        return;
      const opts = getoptions();
      const item = new_item();
      workertask(item, info, d, opts, settings);
  };
}
