def setup_client_routes(app):
  from os.path import dirname, join
  app.router.add_static('/client', join(dirname(__file__), 'client'))

def main():
  from httpstan import routes
  httpstan_setup_routes = routes.setup_routes
  def setup_routes(app):
    httpstan_setup_routes(app)
    setup_client_routes(app)
  routes.setup_routes = setup_routes
  from aiohttp.web import run_app
  from httpstan.app import make_app
  run_app(make_app(), host='localhost', port=8080)

if __name__ == '__main__':
  main()
