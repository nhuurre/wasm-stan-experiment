#include <emscripten.h>

#include <stan/callbacks/interrupt.hpp>
#include <stan/callbacks/logger.hpp>
#include <stan/callbacks/writer.hpp>
#include <cmdstan/io/json/json_data.hpp>
#include <stan/io/empty_var_context.hpp>
#include <stan/model/model_base.hpp>
#include <stan/services/sample/fixed_param.hpp>
#include <stan/services/sample/hmc_nuts_diag_e_adapt.hpp>
#include <stan/math/prim/mat/fun/Eigen.hpp>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <memory>

extern "C" {
  // stanlib.js
  void js_stan_message(int writer_id, size_t n, const char *s);
  void js_stan_double(int writer_id, double d);
  void js_stan_name(int writer_id, size_t n, const char *s);
  void js_stan_begin(int writer_id, size_t size);
  void js_stan_finish_array(int writer_id);
  void js_stan_finish_names(int writer_id);
  void js_stan_debug_msg(size_t n, const char *s);
}
void send_debug_msg(const std::string& msg) {
  js_stan_debug_msg(msg.size(), &msg[0]);
}

class nodejs_logger : public stan::callbacks::logger {
  private:

  int writer_id_;

  public:

  nodejs_logger(int writer_id) : writer_id_(writer_id) {
  }

  void debug(const std::string& message) {
    info(message);
  }

  void debug(const std::stringstream& message) {
    debug(message.str());
  }

  void info(const std::string& message) {
    js_stan_message(writer_id_, message.size(), &message[0]);
  }

  void info(const std::stringstream& message) {
    info(message.str());
  }

  void warn(const std::string& message) {
    info(message);
  }

  void warn(const std::stringstream& message) {
    warn(message.str());
  }

  void error(const std::string& message) {
    info(message);
  }

  void error(const std::stringstream& message) {
    error(message.str());
  }

  void fatal(const std::string& message) {
    info(message);
  }

  void fatal(const std::stringstream& message) {
    fatal(message.str());
  }
};

class nodejs_writer : public stan::callbacks::writer {
  private:

  int writer_id_;

  public:

  nodejs_writer(int writer_id) : writer_id_(writer_id) {
  }

  void operator()(const std::vector<std::string>& names) {
    js_stan_begin(writer_id_, names.size());
    for (int i = 0; i < names.size(); i++) {
      js_stan_name(writer_id_, names[i].size(), &names[i][0]);
    }
    js_stan_finish_names(writer_id_);
  }

  void operator()(const std::vector<double>& state) {
    js_stan_begin(writer_id_, state.size());
    for (int i = 0; i < state.size(); i++) {
      js_stan_double(writer_id_, state[i]);
    }
    js_stan_finish_array(writer_id_);
  }

  void operator()() {
    // ignore blank lines
  }

  void operator()(const std::string& message) {
    js_stan_message(writer_id_, message.size(), &message[0]);
  }
};

void convert_to_json(std::fstream& stream, std::string data) {
  stream << "\"" << data << "\"";
}
void convert_to_json(std::fstream& stream, size_t data) {
  stream << data;
}
template<typename T>
void convert_to_json(std::fstream& stream, std::vector<T>& vectr) {
  stream << "[";
  if (vectr.size() > 0)
    convert_to_json(stream, vectr[0]);
  for (int i = 1; i < vectr.size(); i++) {
    stream << ", ";
    convert_to_json(stream, vectr[i]);
  }
  stream << "]";
}

extern "C" int EMSCRIPTEN_KEEPALIVE get_params(int random_seed) {
  try {
    std::fstream datastream("/data/data.json", std::fstream::in);
    cmdstan::json::json_data data_context(datastream);
    datastream.close();
    std::fstream paramstream("/params.json", std::fstream::out);
    stan_model model(data_context, random_seed);
    std::vector<std::string> names;
    model.get_param_names(names);
    paramstream << "{ \"names\": ";
    convert_to_json(paramstream, names);
    names.resize(0);
    model.constrained_param_names(names);
    paramstream << ", \"constrained_names\": ";
    convert_to_json(paramstream, names);
    std::vector<std::vector<size_t>> dims;
    model.get_dims(dims);
    paramstream << ", \"dims\": ";
    convert_to_json(paramstream, dims);
    paramstream << "}";
    paramstream.close();
    return 0;
  } catch (const std::exception& e) {
    std::fstream err("/errors.txt", std::fstream::out);
    err << e.what() << std::endl;
    return 1;
  }
}


extern "C" int EMSCRIPTEN_KEEPALIVE hmc_nuts_diag_e_adapt_sample(
      int random_seed, int id, double init_radius,
      int num_warmup, int num_samples, int num_thin, int save_warmup,
      int refresh, double stepsize, double stepsize_jitter, int max_depth,
      double delta, double gamma, double kappa, double t0,
      int init_buffer, int term_buffer, int window) {
  try {
    nodejs_logger logger(1);
    nodejs_writer init_writer(2);
    stan::callbacks::interrupt interrupt;
    nodejs_writer sample_writer(3);
    nodejs_writer diagnostic_writer(4);

    std::fstream stream("/data/data.json", std::fstream::in);
    if ((stream.rdstate() & std::ifstream::failbit)) {
      std::stringstream msg;
      msg << "Can't open specified file, \"/data/data.json\"" << std::endl;
      throw std::invalid_argument(msg.str());
    }
    cmdstan::json::json_data data_context(stream);
    stream.close();

    stan::model::model_base& model = new_model(data_context, random_seed, &std::cout);

    stan::io::empty_var_context init_context;

    int return_code = 1; // XXX HttpStan discards return codes

    // XXX adaptive sampler thinks zero-dimensional posterior is improper
    // but the client cannot know the number of unconstrained params because get_params() includes generated quantities
    if (model.num_params_r() == 0) {
      if (save_warmup)
        num_samples += num_warmup; // FIXME: interacts weirdly with thinning (and why is thinning fixed_param even an option?)
      return_code = stan::services::sample::fixed_param(
                      model, init_context, random_seed, id, init_radius,
                      num_samples, num_thin,
                      refresh, interrupt,
                      logger, init_writer, sample_writer, diagnostic_writer);
    } else {
      return_code = stan::services::sample::hmc_nuts_diag_e_adapt(
                        model, init_context, random_seed, id, init_radius,
                        num_warmup, num_samples, num_thin, save_warmup,
                        refresh, stepsize, stepsize_jitter, max_depth,
                        delta, gamma, kappa, t0,
                        init_buffer, term_buffer, window, interrupt,
                        logger, init_writer, sample_writer, diagnostic_writer);
    }

    return 0;
  } catch (const std::exception& e) {
    std::fstream err("/errors.txt", std::fstream::out);
    err << e.what() << std::endl;
    return 1;
  }
}
