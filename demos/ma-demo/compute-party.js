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
var path = require('path');
console.log('Command line arguments: [/path/to/configuration/file.json] [computation_id]');

// Read config
var config = './config.json';
if (process.argv[2] != null) {
  config = './' + process.argv[2];
}

console.log('Using config file: ', path.join(__dirname, config));
config = require(config);

var all_parties = config.compute_parties.concat(config.input_parties);

// Read command line args
var computation_id = 'test';
if (process.argv[3] != null) {
  computation_id = process.argv[3];
}

// Initialize JIFF
var JIFFClient = require('../../lib/jiff-client.js');
var jiffClient = new JIFFClient('http://localhost:8080', computation_id, {
  crypto_provider: config.preprocessing === false, // comment this out if you want to use preprocessing
  party_count: config.party_count,
  initialization: {role: 'compute'} // indicate to the server that this is a compute party
});

// the computation code
var compute = function () {
  jiffClient.wait_for(all_parties, function () {
    // We are a compute party, we do not have any input (thus secret is null),
    // we will receive shares of inputs from all the input_parties.
    var shares1 = jiffClient.share(null, null, config.compute_parties, config.input_parties);
    var shares2 = jiffClient.share(null, null, config.compute_parties, config.input_parties);

    var sum = shares1[config.input_parties[0]];
    for (var i = 1; i < config.input_parties.length; i++) {
      var p = config.input_parties[i];
      sum = sum.sadd(shares1[p]);
    }

    var prod = shares2[config.input_parties[0]];
    for (var i = 1; i < config.input_parties.length; i++) {
      prod = prod.smult(shares2[config.input_parties[i]]);
    }

    jiffClient.open(sum, config.compute_parties).then(function (output) {
      console.log('Final sum output is: ', output);
      jiffClient.open(prod, config.compute_parties).then(output => {
        console.log('Final product output is: ', output);
        jiffClient.disconnect(true, true);
      })
    });
  });
};

// wait only for the compute parties to preprocess
jiffClient.wait_for(config.compute_parties, function () {
  if (config.preprocessing !== false) {
    // do not use crypto provider, perform preprocessing!
    jiffClient.preprocessing('open', 2, null, null, config.compute_parties, config.compute_parties, null, null, {open_parties: all_parties});
    jiffClient.preprocessing("smult", config.input_parties.length, null, null, config.compute_parties, config.compute_parties);
    jiffClient.executePreprocessing(compute.bind(null, jiffClient));
  } else {
    // no preprocessing: use server as crypto provider
    compute();
  }
});
