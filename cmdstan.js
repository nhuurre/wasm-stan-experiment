'strict';

const USAGE = (
`Compile model:
  node cmdstan.js [model.stan]
Fit model:
  node cmdstan.js [modelname] [data.json]
Compile and fit model:
  node cmdstan.js [model.stan] [data.json]`
);

const fs = require('fs');

const cache = require('./server/cache.js');

async function compile_model(src_file) {
  const program_code = fs.readFileSync(src_file);
  const compiler = require('./server/compiler.js');
  await compiler.setup();
  console.log(`Compiling model...`);
  await cache.setup();
  const model = await compiler.compile_model(program_code);
  console.log(`Model name: ${model.name}`);
  console.log(`File created: ${cache.file(model.name, 'model.stan')}`);
  console.log(`File created: ${cache.file(model.name, 'model.js')}`);
  console.log(`File created: ${cache.file(model.name, 'model.wasm')}`);
  return model;
}

async function run_model(model, data_file, output_file) {
  const fits = require('./server/fits.js');
  const data = data_file === '-' ? {} : JSON.parse(fs.readFileSync(data_file));
  const options = {};
  const output = fs.createWriteStream(output_file || './output.csv');
  const samples = await fits.run_worker(model, data, options);
  const names = [];
  for (let n in samples)
    names.push(n);
  output.write(names.join(','));
  output.write('\n');
  const num_samples = samples[names[0]].length;
  let idx = 0;
  while (idx < num_samples) {
    const line = names.map((n) => samples[n][idx]);
    output.write(line.join(','));
    output.write('\n');
    idx += 1;
  }
}

function find_model(model_name) {
  if (model_name.startsWith('models/'))
    model_name = model_name.slice(7);
  let model = cache.lookup_model(model_name);
  if (model === undefined) {
    // not a full name, maybe a prefix
    model_name = `models/{model_name}`;
    for (let mod of cache.list_models().models)
      if (mod.name.startsWith(model_name))
        if (model === undefined) {
          model = mod;
        } else {
          console.log(`Model name prefix ${model_name} is ambiguous.`);
          return undefined;
        }
  }
  if (model === undefined)
    console.log(`Expected model name or .stan file but found ${model_name}`);
  return model;
}

async function main([src_file, data_file, output_file]) {
  if (src_file === '--version') {
    const { setup, version_info } = require('./server/compiler.js');
    await setup();
    console.log(await version_info());
    return;
  }
  let model = undefined;
  if (src_file.endsWith('.stan'))
    model = await compile_model(src_file);
  else
    model = find_model(src_file.toLowerCase());
  if (model === undefined) {
    console.log(USAGE);
    return;
  }
  if (!data_file) {
    console.log('Invoke compiled model:');
    let [prefix, model_id] = model.name.split('/');
    console.log(`  node cmdstan.js ${model_id} [data.json]`);
  } else {
    run_model(model, data_file, output_file);
  }
}

main(process.argv.slice(2));

