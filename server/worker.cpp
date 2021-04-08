#include <emscripten.h>

#include <stan/callbacks/interrupt.hpp>
#include <stan/callbacks/logger.hpp>
#include <stan/callbacks/writer.hpp>
#include <cmdstan/io/json/json_data.hpp>
#include <stan/io/empty_var_context.hpp>
#include <stan/model/log_prob_grad.hpp>
#include <stan/model/log_prob_propto.hpp>
#include <stan/model/model_base.hpp>
#include <stan/services/sample/fixed_param.hpp>
#include <stan/services/sample/hmc_nuts_diag_e_adapt.hpp>
#include <stan/services/util/create_rng.hpp>
#include <stan/math/prim/fun/Eigen.hpp>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <memory>

extern "C" {
  // stanlib.js
  void js_stan_message(int writer_id, int prefix, size_t n, const char *s);
  void js_stan_double(int writer_id, double d);
  void js_stan_name(int writer_id, size_t n, const char *s);
  void js_stan_begin(int writer_id, size_t size);
  void js_stan_finish_array(int writer_id);
  void js_stan_finish_names(int writer_id);
  void js_stan_debug_msg(size_t n, const char *s);

  double js_stan_read_param(int idx);
  double js_stan_write_param(double value);
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
    js_stan_message(writer_id_, 1, message.size(), &message[0]);
  }

  void debug(const std::stringstream& message) {
    debug(message.str());
  }

  void info(const std::string& message) {
    js_stan_message(writer_id_, 2, message.size(), &message[0]);
  }

  void info(const std::stringstream& message) {
    info(message.str());
  }

  void warn(const std::string& message) {
    js_stan_message(writer_id_, 3, message.size(), &message[0]);
  }

  void warn(const std::stringstream& message) {
    warn(message.str());
  }

  void error(const std::string& message) {
    js_stan_message(writer_id_, 4, message.size(), &message[0]);
  }

  void error(const std::stringstream& message) {
    error(message.str());
  }

  void fatal(const std::string& message) {
    js_stan_message(writer_id_, 5, message.size(), &message[0]);
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
    js_stan_message(writer_id_, 0, message.size(), &message[0]);
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
    std::fstream paramstream("/output.json", std::fstream::out);
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

extern "C" int EMSCRIPTEN_KEEPALIVE do_function(int flat_params, int func, bool adjust_transform, bool include_tparams, bool include_gqs, int random_seed) {
  try {
    std::fstream datastream("/data/data.json", std::fstream::in);
    cmdstan::json::json_data data_context(datastream);
    datastream.close();
    stan_model model(data_context, random_seed);
    std::vector<int> param_i;
    std::vector<double> param_r(flat_params);
    for (int i = 0; i < flat_params; i++)
      param_r[i] = js_stan_read_param(i);
    std::vector<double> param_out;
    if (func == 1) {
      double lp;
      if (adjust_transform)
        lp = stan::model::log_prob_propto<true>(model, param_r, param_i, NULL);
      else
        lp = stan::model::log_prob_propto<false>(model, param_r, param_i, NULL);
      param_out.push_back(lp);
    } else if (func == 2) {
      if (adjust_transform)
        stan::model::log_prob_grad<true,true>(model, param_r, param_i, param_out, NULL);
      else
        stan::model::log_prob_grad<true,false>(model, param_r, param_i, param_out, NULL);
    } else if (func == 3) {
      boost::ecuyer1988 rng = stan::services::util::create_rng(random_seed, 1);
      model.write_array(rng, param_r, param_i, param_out, include_tparams, include_gqs, NULL);
    }
    for (double x : param_out)
      js_stan_write_param(x);
    return 0;
  } catch (const std::exception& e) {
    std::fstream err("/errors.txt", std::fstream::out);
    err << e.what() << std::endl;
    return 1;
  }
}

extern "C" int EMSCRIPTEN_KEEPALIVE get_transform_inits(int random_seed) {
  try {
    std::fstream datastream("/data/data.json", std::fstream::in);
    cmdstan::json::json_data data_context(datastream);
    datastream.close();
    stan_model model(data_context, random_seed);
    std::fstream paramstream("/params.json", std::fstream::in);
    cmdstan::json::json_data param_context(paramstream);
    paramstream.close();
    std::vector<int> param_i;
    std::vector<double> unconstrained;
    model.transform_inits(param_context, param_i, unconstrained, NULL);
    for (double x : unconstrained)
      js_stan_write_param(x);
    return 0;
  } catch (const std::exception& e) {
    std::fstream err("/errors.txt", std::fstream::out);
    err << e.what() << std::endl;
    return 1;
  }
}

extern "C" int EMSCRIPTEN_KEEPALIVE mcmc_sample(
      bool fixed_sampler, int random_seed, int id, double init_radius,
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

    std::fstream pstream("/params.json", std::fstream::in);
    cmdstan::json::json_data init_context(pstream);
    pstream.close();

    int return_code = 1;

    // XXX adaptive sampler thinks zero-dimensional posterior is improper
    // but the client cannot know the number of unconstrained params because get_params() includes generated quantities
    if (fixed_sampler || model.num_params_r() == 0) {
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
