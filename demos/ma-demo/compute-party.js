/**
 * This is a compute party: it has no input, and it receives
 * secret-shared inputs from all input parties.
 * Run this compute party from the command line as a node.js
 * server application using:
 *  node compute-party.js [path/to/configuration/file] [computation_id]
 * Configuration file path is optional, by default ./config.js
 * will be used.
 * computation_id is optional, by default it will be 'test'.
 */
var path = require("path");
console.log(
  "Command line arguments: [/path/to/configuration/file.json] [computation_id]"
);

// Read config
var config = "./config.json";
if (process.argv[2] != null) {
  config = "./" + process.argv[2];
}

console.log("Using config file: ", path.join(__dirname, config));
config = require(config);

var all_parties = config.compute_parties.concat(config.input_parties);

// Read command line args
var computation_id = "test";
if (process.argv[3] != null) {
  computation_id = process.argv[3];
}

// Initialize JIFF
var JIFFClient = require("../../lib/jiff-client.js");
var jiff_bignumber = require("../../lib/ext/jiff-client-bignumber");
var jiff_fixedpoint = require("../../lib/ext/jiff-client-fixedpoint");
var jiff_negativenumber = require("../../lib/ext/jiff-client-negativenumber");

var opt = {
  crypto_provider: config.preprocessing === false, // comment this out if you want to use preprocessing
  party_count: config.party_count,
  initialization: { role: "compute" }, // indicate to the server that this is a compute party
  Zp: config.Zp,
  integer_digits: config.integer_digits,
  decimal_digits: config.decimal_digits,
};

var jiffClient = new JIFFClient("http://localhost:8080", computation_id, opt);
jiffClient.apply_extension(jiff_bignumber, opt);
jiffClient.apply_extension(jiff_fixedpoint, opt);
jiffClient.apply_extension(jiff_negativenumber, opt);

var variance = function (X, X_squared) {
  var sum = X[0];
  var squaresum = X_squared[0];
  for (var i = 1; i < X.length; i++) {
    sum = sum.sadd(X[i]);
    squaresum = squaresum.sadd(X_squared[i]);
  }
  var squared_sum = sum.smult(sum);
  squaresum = squaresum.cmult(X.length);
  var diff = squaresum.ssub(squared_sum);
  return diff.cdiv(X.length * X.length);
};

var mean = function (X) {
  var sum = X[0];
  for (var i = 1; i < X.length; i++) {
    sum = sum.sadd(X[i]);
  }
  return sum.cdiv(X.length);
};

// the computation code
var compute = function () {
  jiffClient.wait_for(all_parties, function () {
    // We are a compute party, we do not have any input (thus secret is null),
    // we will receive shares of inputs from all the input_parties.
    var shares1 = jiffClient.share(
      null,
      null,
      config.compute_parties,
      config.input_parties
    );
    var shares1_squared = jiffClient.share(
      null,
      null,
      config.compute_parties,
      config.input_parties
    );

    if (config.debug_output) {
      var sum = shares1[config.input_parties[0]];
      for (var i = 1; i < config.input_parties.length; i++) {
        var p = config.input_parties[i];
        sum = sum.sadd(shares1[p]);
      }

      var shares2 = jiffClient.share(
        null,
        null,
        config.compute_parties,
        config.input_parties
      );
      var prod = shares2[config.input_parties[0]];
      for (var i = 1; i < config.input_parties.length; i++) {
        prod = prod.smult(shares2[config.input_parties[i]]);
      }

      prod = prod.sdiv(sum);
    }

    // Inputs from parties with even IDs go in X1,
    // inputs with odd IDs go in X2.
    var X1 = [];
    var X1_squared = [];
    var X2 = [];
    var X2_squared = [];
    for (var p = 0; p < config.input_parties.length; p++) {
      var i = config.input_parties[p];
      if (i % 2 == 0) {
        X1.push(shares1[i]);
        X1_squared.push(shares1_squared[i]);
      } else {
        X2.push(shares1[i]);
        X2_squared.push(shares1_squared[i]);
      }
    }

    //console.log(X1, X1_squared, X2, X2_squared)

    var m1 = mean(X1);
    var m2 = mean(X2);
    var s1 = variance(X1, X1_squared);
    var s2 = variance(X2, X2_squared);

    var nom = m1.ssub(m2);
    nom = nom.smult(nom);
    var denom = s1.cdiv(X1.length).sadd(s2.cdiv(X2.length));
    var tsq = nom.sdiv(denom);

    if (config.debug_output) {
      var results = [sum, tsq, m1, m2, s1, s2, nom, denom, prod];

      Promise.all(
        results.map((sh) => jiffClient.open(sh, config.compute_parties))
      ).then((vals) => {
        console.log(
          "Final output:",
          vals.map((x) => x.toString())
        );
        console.log(typeof vals[1]);
        console.log("t-test result: ", Math.sqrt(vals[1]));
        jiffClient.disconnect(true, true);
      });
    } else {
      jiffClient.open(tsq, config.compute_parties).then((res) => {
        console.log("t^2: ", res.toString());
        console.log("t: ", Math.sqrt(res));
        jiffClient.disconnect(true, true);
      });
    }
  });
};

// wait only for the compute parties to preprocess
jiffClient.wait_for(config.compute_parties, function () {
  if (config.preprocessing !== false) {
    // do not use crypto provider, perform preprocessing!
    jiffClient.preprocessing(
      "open",
      2,
      null,
      null,
      config.compute_parties,
      config.compute_parties,
      null,
      null,
      { open_parties: all_parties }
    );
    jiffClient.preprocessing(
      "smult",
      config.input_parties.length,
      null,
      null,
      config.compute_parties,
      config.compute_parties
    );
    jiffClient.preprocessing(
      "sdiv",
      config.input_parties.length,
      null,
      null,
      config.compute_parties,
      config.compute_parties
    );
    jiffClient.executePreprocessing(compute.bind(null, jiffClient));
  } else {
    // no preprocessing: use server as crypto provider
    compute();
  }
});
