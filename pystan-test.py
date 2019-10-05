import os.path
from subprocess import Popen, DEVNULL

assert 'CMDSTAN_PATH' in os.environ, 'CmdStan needed, please set $CMDSTAN_PATH'
try:
  assert Popen(['em++', '--version'],
        stdin=DEVNULL, stdout=DEVNULL).wait() == 0, 'Emscripten failed'
except FileNotFoundError:
  assert False, 'Emscripten not found, please install it'

# XXX
# pystan-next checks that the model name is what httpstan thinks it should be
# but model names are supposed to be implementation-specific
# no good way to verify them, just accept whatever
class model_name:
  def __init__(self, source): pass
  def split(self, s):
    assert s == '/'
    return ['models', '0000000000']
  def __eq__(self, other):
    if isinstance(other, str):
      return other.startswith('models/')
    return NotImplemented

class Server:
  host = 'localhost'
  port = 8080
  def start(self):
    pass
  def stop(self):
    pass

import httpstan.main
import httpstan.models
httpstan.models.calculate_model_name = model_name
httpstan.main.Server = Server

import sys
sys.path.insert(0, '.')

nodedir = os.path.dirname(__file__)
nodejsserver = os.path.join(nodedir, 'server', 'main.js')
server_cmd = ['node', '--experimental-worker', nodejsserver]
server = Popen(server_cmd, stdin=DEVNULL, stdout=DEVNULL, stderr=DEVNULL)
try:
  import time, pytest
  time.sleep(5) # wait for the server to start
  pytest.main()
finally:
  server.terminate()

