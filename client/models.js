import { make_list, task_monitor } from './common.js';
import { create_fit } from './fits.js';

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
    modelview(new_item(), model, settings);
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

