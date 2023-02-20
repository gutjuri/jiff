(function (exports, node) {
  if (node) {
    // eslint-disable-next-line no-undef
    JIFFClient = require("../../lib/jiff-client.js");
    // eslint-disable-next-line no-undef
    jiff_restAPI = require("../../lib/ext/jiff-client-restful.js");

    var jiff_bignumber = require("../../lib/ext/jiff-client-bignumber");
    var jiff_fixedpoint = require("../../lib/ext/jiff-client-fixedpoint");
    var jiff_negativenumber = require("../../lib/ext/jiff-client-negativenumber");
  }

  var __jiff_instance, config;
  exports.connect = function (hostname, computation_id, options, _config) {
    config = _config;

    var opt = Object.assign({}, options);
    opt["crypto_provider"] = config.preprocessing === false;
    opt["initialization"] = { role: "input" };
    opt["party_count"] = config.party_count;
    opt["autoConnect"] = false;

    // eslint-disable-next-line no-undef
    __jiff_instance = new JIFFClient(hostname, computation_id, opt);
    // eslint-disable-next-line no-undef
    __jiff_instance.apply_extension(jiff_restAPI);
    __jiff_instance.apply_extension(jiff_bignumber, opt);
    __jiff_instance.apply_extension(jiff_fixedpoint, opt);
    __jiff_instance.apply_extension(jiff_negativenumber, opt);
    __jiff_instance.connect();
    return __jiff_instance;
  };
})(
  typeof exports === "undefined" ? (this.mpc = {}) : exports,
  typeof exports !== "undefined"
);
