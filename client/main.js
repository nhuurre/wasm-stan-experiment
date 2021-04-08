import { compiler, model_list } from './models.js';

export default
async function setup(root_url, elt) {
  const settings = await create_connection(root_url);
  elt.text('');
  if (settings.compile)
    compiler(elt, settings);
  else
    model_list(elt, settings);
}

async function create_connection(root_url) {
  const stream = await fetch(new URL('health', root_url));
  let settings;
  try {
    settings = await stream.json();
  } catch (err) {
    settings = {
      model_info: false,
      compile: true,
      random: false,
      wasm: false,
      fit: true
    };
  }
  settings.url = root_url;
  settings.fetch = async(url, status, data) => {
    const request = new Request(
    new URL(url, root_url),
    data ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    } : undefined);
    const stream = await fetch(request);
    const response = await stream.json();
    if (status && stream.status !== status)
      throw new Error(response.message);
    return response;
  };
  return settings;
}
