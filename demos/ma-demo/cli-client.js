/**
 * Do not modify this file unless you have to.
 * This file has UI handlers.
 */

/* global config */

mpc = require("./client-mpc.js")

// eslint-disable-next-line no-unused-vars
async function connect_and_submit() {
    var computation_id = "test";
    var input1 = Number(process.argv[2])
    var input2 = Number(process.argv[3])
    console.log(`Running with input1 = ${input1} and input2 = ${input2}`)
    
    hostname = 'http://localhost' + ':' + '8080';
    var config = await fetch(hostname + "/config.json").then(res => res.json());
    var options = { party_count: config.party_count, Zp: "486024591023"};
  
    // eslint-disable-next-line no-undef
    var jiff = mpc.connect(hostname, computation_id, options, config);
    console.log(jiff.Zp.toString())
    jiff.wait_for(config.compute_parties, function () {
        jiff.share(input1, null, config.compute_parties, config.input_parties);
        jiff.share(input2, null, config.compute_parties, config.input_parties);
        jiff.disconnect(true, true)
    });
  }

  connect_and_submit()
  