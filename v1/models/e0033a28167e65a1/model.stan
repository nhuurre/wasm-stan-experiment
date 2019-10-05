data {
  int<lower=0> N;
  int<lower=0> P;
  int<lower=0> n[N];
  int<lower=0> k[N];
  matrix[N,P] x;
} parameters {
  real intercept;
  vector[P] beta;
} model {
  intercept ~ logistic(0, 1);
  beta ~ std_normal();
  k ~ binomial_logit(n, intercept + x * beta);
} generated quantities {
  real intercept_prob = inv_logit(intercept);
}