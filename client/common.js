export
function make_list(elt, cls) {
  const ul = elt.append('ul');
  if (cls) elt.classed(cls, true);
  ul.append('li').classed('placeholder', true).text('--none--');
  return (pos) => ul.insert('li', pos ? pos : ':first-child');
}

export
function task_monitor(elt) {
  elt = elt.append('div').classed('monitor', true);
  const box = elt.append('pre').append('samp');
  box.classed('hidden', true);
  const progress = elt.append('progress');
  progress.node().hidden = true;
  async function monitor(task, suppress) {
    box.classed('hidden', true);
    progress.node().hidden = false;
    try {
      if (task instanceof Function)
        task = task();
      if (task instanceof Promise)
        task = await task;
      return task;
    } catch (error) {
      box.classed('stale', false);
      box.classed('hidden', false);
      box.text(error.message);
      if (!suppress)
        throw error;
    } finally {
      progress.node().hidden = true;
    }
  }
  monitor.update = (value, max) =>
    void progress.attr('value', value).attr('max', max || 1.0);
  monitor.stale = () =>
    void box.classed('stale', true);
  monitor.remove = () =>
    void elt.remove();
  return monitor;
}

let sampler_default_args;
export
async function get_sampler_default_args() {
  if (sampler_default_args)
    return sampler_default_args;
  const stream = await fetch(
    new URL('./cmdstan-help-all.json', import.meta.url)
  );
  const cmdstan_defaults = await stream.json();
  sampler_default_args = {
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
  return sampler_default_args;
}

export
function data_input(elt) {
  const fileinput =
    elt.append('label')
       .text('Data file: ')
       .append('input')
       .attr('type', 'file')
       .attr('accept', 'application/json');
  const edit = elt.append('details');
  edit.append('summary').text('Data editor');
  const editbox =
    edit.append('textarea')
        .attr('rows', 10)
        .attr('cols', 50);
  const resetdata =
    edit.append('button')
        .text('reload')
        .attr('title', 'load data from file');
  resetdata.node().disabled = fileinput.node().files.length === 0;
  const dataerror = elt.append('div');
  dataerror.node().hidden = true;
  let databoxsync = true;
  let databoxfilled = false;
  async function read_inputfile() {
    const file = fileinput.node().files[0];
    if (!file)
      return '{\n}';
    return await file.text();
  }
  edit.node().addEventListener('toggle', async() => {
    if (!databoxfilled) {
      editbox.node().value = await read_inputfile();
      databoxfilled = true;
      databoxsync = true;
    }
  });
  editbox.node().oninput = () => {
    if (databoxsync) {
      databoxsync = false;
      databoxfilled = true;
      resetdata.node().disabled = fileinput.node().files.length === 0;
      dataerror.classed('stale', true);
    }
  };
  fileinput.node().oninput = async() => {
    if (edit.node().open && !databoxsync) {
      editbox.node().value = await read_inputfile();
      databoxsync = true;
      resetdata.node().disabled = true;
    } else {
      databoxfilled = false;
    }
    dataerror.node().hidden = true;
  };
  resetdata.node().onclick = async() => {
    editbox.node().value = await read_inputfile();
    databoxsync = true;
    resetdata.node().disabled = true;
    dataerror.node().hidden = true;
  };

  async function getdata() {
    try {
      let data;
      if (databoxfilled) {
        const val = editbox.node().value;
        if (val.trim() === '')
          data = {};
        else
          data = JSON.parse(val);
      } else {
        const file = fileinput.node().files[0];
        if (!file)
          data = {};
        else
          data = await new Response(file).json();
      }
      dataerror.node().hidden = true;
      return data;
    } catch (error) {
      dataerror.text(error.message);
      dataerror.classed('stale', false);
      dataerror.node().hidden = false;
    }
  }
  getdata.setdata = (data, open) => {
    const s = JSON.stringify(data).split(',"');
    editbox.node().value = s.join(',\n"');
    databoxsync = false;
    resetdata.node().disabled = fileinput.node().files.length === 0;
    databoxfilled = true;
    dataerror.node().hidden = true;
    if (open !== undefined)
      edit.node().open = open;
  };
  return getdata;
}

export
async function options(elt) {
  const sampler_defaults = await get_sampler_default_args();
  const num_draws =
    elt.append('label')
       .text('Draws ')
       .append('input')
       .attr('type', 'number')
       .attr('min', 1)
       .attr('value', sampler_defaults.num_samples);
  const rng =
    elt.append('details');
  rng.append('summary').text('Randomization');
  const random_seed =
    rng.append('label')
       .text('Random seed ')
       .append('input')
       .attr('type', 'number')
       .attr('min', 1)
       .attr('max', 2147483647)
       .attr('value', Math.floor(2147483648*Math.random()));
  rng.append('br');
  const chain_id =
    rng.append('label')
       .text('Chain ID ')
       .append('input')
       .attr('type', 'number')
       .attr('min', 1)
       .attr('value', sampler_defaults.chain);
  const adapt =
    elt.append('details');
  adapt.append('summary').text('Adaptation');
  const num_warmup =
    adapt.append('label')
         .text('Warmup ')
         .append('input')
         .attr('type', 'number')
         .attr('min', 200)
         .attr('value', sampler_defaults.num_warmup);
  adapt.append('br');
  const delta =
    adapt.append('label')
         .text('Target delta ')
         .append('input')
         .attr('type', 'number')
         .attr('min', 0)
         .attr('step', 0.001)
         .attr('max', 1)
         .attr('value', sampler_defaults.delta);
  const corr =
    elt.append('details');
  corr.append('summary').text('Autocorrelation');
  const num_thin =
    corr.append('label')
        .text('Thinning ')
        .append('input')
        .attr('type', 'number')
        .attr('min', 1)
        .attr('value', sampler_defaults.num_thin);
  corr.append('br');
  const max_depth =
    corr.append('label')
        .text('Maximum depth ')
        .append('input')
        .attr('type', 'number')
        .attr('min', 1)
        .attr('value', sampler_defaults.max_depth);

  return () => {
    const warm = num_warmup.node().valueAsNumber;
    const thinned = num_thin.node().valueAsNumber;
    const samp = (num_draws.node().valueAsNumber-1)*thinned + 1;
    return {
      ...sampler_defaults,
      random_seed: random_seed.node().valueAsNumber,
      chain: chain_id.node().valueAsNumber,
      num_warmup: warm,
      num_thin: thinned,
      num_samples: samp,
      refresh: Math.floor((warm + samp) / 20),
      max_depth: max_depth.node().valueAsNumber,
      delta: delta.node().valueAsNumber
    };
  }
}
