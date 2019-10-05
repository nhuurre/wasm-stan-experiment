mergeInto(LibraryManager.library, {
  js_stan_message: function(w, n, s) {
    live_writers.get(w).write_message(UTF8ToString(s, n));
  },
  js_stan_begin: function(w, n) {
    live_writers.get(w).begin_array(n);
  },
  js_stan_double: function(w, d) {
    live_writers.get(w).append_double(d);
  },
  js_stan_name: function(w, n, s) {
    live_writers.get(w).append_name(UTF8ToString(s, n));
  },
  js_stan_finish_array: function(w) {
    live_writers.get(w).finish_array();
  },
  js_stan_finish_names: function(w) {
    live_writers.get(w).finish_names();
  },
  js_stan_debug_msg: function(n, s) {
    sendMessage({
      info: 'debug',
      msg: UTF8ToString(s, n)
    });
  }
});
