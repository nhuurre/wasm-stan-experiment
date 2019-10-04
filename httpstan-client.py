def setup_client_routes(app):
  from os.path import dirname, join
  app.router.add_static("/static", join(dirname(__file__), 'client'))

def main():
  import httpstan.routes
  httpstan_setup_routes = httpstan.routes.setup_routes
  def setup_routes(app):
    httpstan_setup_routes(app)
    setup_client_routes(app)
  httpstan.routes.setup_routes = setup_routes
  from httpstan.__main__ import main
  main()

if __name__ == '__main__':
  main()
