from subprocess import run, Popen, DEVNULL
from pathlib import Path
wasmstan_dir = Path(__file__).parent

backend_info = run(['node', wasmstan_dir/'cmdstan.js', '--version'], capture_output=True)
assert backend_info.returncode == 0, backend_info.stderr
backend_info = backend_info.stdout[:-1]
from hashlib import blake2b
def calculate_model_name(program_code : str) -> str:
    hash = blake2b()
    hash.update(program_code.encode())
    hash.update(backend_info)
    return 'models/' + hash.hexdigest()[:16]

class NodestanRunner:
    def __init__(self, app=None):
        self.host = 'localhost'
        self.port = 8080
    async def setup(self):
        pass
    def start(self):
        self.process = Popen(['node', wasmstan_dir/'server'/'main.js', self.host, str(self.port)],
                             stdin=DEVNULL, stdout=DEVNULL, stderr=DEVNULL)
        import time
        time.sleep(1) # wait for the server to start
    async def cleanup(self):
        self.process.terminate()
class TCPSite:
    def __init__(self, runner, host, port):
        runner.host = host
        runner.port = port
        self.runner = runner
    async def start(self):
        self.runner.start()

def monkeypatch_httpstan():
    import httpstan.models
    import aiohttp.web
    httpstan.models.calculate_model_name = calculate_model_name
    aiohttp.web.AppRunner = NodestanRunner
    aiohttp.web.TCPSite = TCPSite

def monkeypatch_pystan():
    import httpstan.models
    httpstan.models.calculate_model_name = calculate_model_name
    import stan.common
    from aiohttp import ClientSession
    class NodestanClient(stan.common.HttpstanClient):
        async def __aenter__(self):
            host, port = 'localhost', 8080
            self.runner = NodestanRunner()
            self.runner.start()
            self.session = ClientSession()
            self.base_url = f'http://{host}:{port}/v1'
            return self
    stan.common.HttpstanClient = NodestanClient

def httpstan_tests():
    monkeypatch_httpstan()
    import sys
    # httpstan.openapi imports additional dependencies we want to avoid
    sys.modules['httpstan.openapi'] = type(sys)("httpstan.openapi")
    skiplist = [
      'test_function_arguments', # httpstan internal test
      'test_list_model_names',   # ^
      'test_openapi_spec',       # ^
      'test_cvodes', # nodestan does not support ODE solvers
      'test_bernoulli_unacceptable_arg', # expect good errors for bad queries
      'test_bernoulli_unknown_arg',      # ^
      'test_build_unknown_arg',          # ^
      'test_models_actions_bad_args',    # ^
      'test_user_inits_invalid_value',   # ^
      'test_nan_inf', # JSON has problems representing INF correctly
      ]
    return ['-k', ' and '.join('not ' + t for t in skiplist)]

def pystan_tests():
    monkeypatch_pystan()
    skiplist = [
      'test_fit_cache', # nodestan cache is separate from httpstan cache
      'test_nan_inf', # JSON has problems representing INF correctly
      ]
    return ['-k', ' and '.join('not ' + t for t in skiplist)]

def run_pytest():
    import pytest
    func = globals()[Path().absolute().name + '_tests']
    pytest.main(func())

if __name__ == '__main__':
    run_pytest()
