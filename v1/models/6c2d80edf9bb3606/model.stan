data {
  int<lower=3> N;
  int<lower=0> P;
  matrix[N,P] x;
  vector[N] y;
} parameters {
  real intercept;
  vector[P] beta;
  real<lower=0> sigma;
} model {
  beta ~ std_normal();
  y ~ normal(intercept + x*beta, sigma);
}
