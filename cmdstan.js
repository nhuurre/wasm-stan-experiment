'strict';

const USAGE = (
`Compile model:
  node cmdstan.js [model.stan]
Fit model:
  node --experimental-worker cmdstan.js [modelname] [data.json]`
);

const fs = require('fs');

const cache = require('./server/cache.js');

async function main(argv) {
  await cache.setup();
  if (argv.length === 1 &&
      argv[0].endsWith('.stan')) {

    const program_code = fs.readFileSync(argv[0]);
    const compiler = require('./server/compiler.js');
    await compiler.setup();
    try {
      console.log(`Compiling model...`);
      const model = await compiler.compile_model(program_code);
      await cache.write_models();
      console.log(`Model name: ${model.id}`);
      console.log(`File created: ${cache.file('models', model.id, 'model.stan')}`);
      console.log(`File created: ${cache.file('models', model.id, 'model.js')}`);
      console.log(`File created: ${cache.file('models', model.id, 'model.wasm')}`);
      console.log('Invoke compiled model:');
      console.log(`  node --experimental-worker cmdstan.js ${model.id} [data.json]`);
    } catch (err) {
      console.error(err.message);
    }

  } else if (argv.length === 2 &&
             /^(models\/)?[0-9a-fA-F]+$/.test(argv[0]) &&
             argv[1].endsWith('.json')) {

    const model_id = argv[0].startsWith('models/') ? argv[0].slice(7).toLowerCase() : argv[0].toLowerCase();
    const model = cache.lookup_model(model_id);
    if (model) {
      const fits = require('./server/fits.js');
      const data = JSON.parse(fs.readFileSync(argv[1]));
      const options = {};
      const output = fs.createWriteStream('./output.csv');
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
    } else {
      console.error(`Model ${model_id} not found.`);
    }

  } else {
    console.log(USAGE);
  }
}

main(process.argv.slice(2)).catch((err) => { console.error(err); });
