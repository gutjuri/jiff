/**
 * Do not modify this file unless you have to.
 * This file has UI handlers.
 */

/* global config */

mpc = require("./client-mpc.js");

// eslint-disable-next-line no-unused-vars
async function connect_and_submit() {
  var computation_id = "test";
  var input1 = Number(process.argv[3]);
  var input2 = Number(process.argv[4]);
  console.log(
    `Running as party ${Number(
      process.argv[2]
    )} with input1 = ${input1} and input2 = ${input2}`
  );

  hostname = "http://localhost" + ":" + "8080";
  var config = await fetch(hostname + "/config.json").then((res) => res.json());
  var options = {
    party_count: config.party_count,
    party_id: Number(process.argv[2]),
    Zp: config.Zp,
    integer_digits: config.integer_digits,
    decimal_digits: config.decimal_digits,
  };

  // eslint-disable-next-line no-undef
  var jiff = mpc.connect(hostname, computation_id, options, config);

  //input1 = jiff.helpers.BigNumber(input1)
  //input2 = jiff.helpers.BigNumber(input2)
  //console.log(input1.toString())

  jiff.wait_for(config.compute_parties, function () {
    jiff.share(input1, null, config.compute_parties, config.input_parties);
    jiff.share(
      input1 * input1,
      null,
      config.compute_parties,
      config.input_parties
    );
    if (config.debug_output) {
      jiff.share(input2, null, config.compute_parties, config.input_parties);
    }
    jiff.disconnect(true, true);
  });
}

connect_and_submit();
