(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.jiff_websockets = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var initializationHandlers = require('./handlers/initialization.js');
var shareHandlers = require('./handlers/sharing.js');
var customHandlers = require('./handlers/custom.js');
var cryptoProviderHandlers = require('./handlers/crypto_provider.js');

/**
 * Contains handlers for communication events
 * @name handlers
 * @alias handlers
 * @namespace
 */

// Add handlers implementations
module.exports = function (jiffClient) {
  // fill in handlers
  initializationHandlers(jiffClient);
  shareHandlers(jiffClient);
  customHandlers(jiffClient);
  cryptoProviderHandlers(jiffClient);
};
},{"./handlers/crypto_provider.js":2,"./handlers/custom.js":3,"./handlers/initialization.js":4,"./handlers/sharing.js":5}],2:[function(require,module,exports){
// setup handler for receiving messages from the crypto provider
module.exports = function (jiffClient) {
  /**
   * Parse crypto provider message and resolve associated promise.
   * @method
   * @memberof handlers
   * @param {object} json_msg - the parsed json message as received by the crypto_provider event, contains 'values' and 'shares' attributes.
   */
  jiffClient.handlers.receive_crypto_provider = function (json_msg) {
    // Hook
    json_msg = jiffClient.hooks.execute_array_hooks('afterOperation', [jiffClient, 'crypto_provider', json_msg], 2);

    var op_id = json_msg['op_id'];
    if (jiffClient.deferreds[op_id] == null) {
      return; // duplicate message: ignore
    }

    // parse msg
    var receivers_list = json_msg['receivers'];
    var threshold = json_msg['threshold'];
    var Zp = json_msg['Zp'];

    // construct secret share objects
    var result = {};
    if (json_msg['values'] != null) {
      result.values = json_msg['values'];
    }
    if (json_msg['shares'] != null) {
      result.shares = [];
      for (var i = 0; i < json_msg['shares'].length; i++) {
        result.shares.push(new jiffClient.SecretShare(json_msg['shares'][i], receivers_list, threshold, Zp));
      }
    }

    // resolve deferred
    jiffClient.deferreds[op_id].resolve(result);
    delete jiffClient.deferreds[op_id];
  };
};
},{}],3:[function(require,module,exports){
module.exports = function (jiffClient) {
  /**
   * Called when this party receives a custom tag message from any party (including itself).
   * If a custom listener was setup to listen to the tag, the message is passed to the listener.
   * Otherwise, the message is stored until such a listener is provided.
   * @method
   * @memberof handlers
   * @param {object} json_msg - the parsed json message as received by the custom event.
   */
  jiffClient.handlers.receive_custom = function (json_msg) {
    if (json_msg['party_id'] !== jiffClient.id) {
      if (json_msg['encrypted'] === true) {
        var decrypted = jiffClient.hooks.decryptSign(jiffClient, json_msg['message'], jiffClient.secret_key, jiffClient.keymap[json_msg['party_id']]);
      }
    }

    var ready = function (decrypted) {
      if (json_msg['party_id'] !== jiffClient.id) {
        if (json_msg['encrypted'] === true) {
          json_msg['message'] = decrypted;
        }
        json_msg = jiffClient.hooks.execute_array_hooks('afterOperation', [jiffClient, 'custom', json_msg], 2);
      }

      var sender_id = json_msg['party_id'];
      var tag = json_msg['tag'];
      var message = json_msg['message'];

      if (jiffClient.listeners[tag] != null) {
        jiffClient.listeners[tag](sender_id, message);
      } else {
        // Store message until listener is provided
        var stored_messages = jiffClient.custom_messages_mailbox[tag];
        if (stored_messages == null) {
          stored_messages = [];
          jiffClient.custom_messages_mailbox[tag] = stored_messages;
        }

        stored_messages.push({sender_id: sender_id, message: message});
      }
    }

    if (decrypted != null && decrypted.then) {
      decrypted.then(ready);
    } else if (decrypted != null) {
      ready(decrypted);
    } else {
      ready(json_msg['message']);
    }
  }
};
},{}],4:[function(require,module,exports){
// add handlers for initialization
module.exports = function (jiffClient) {
  jiffClient.options.initialization = Object.assign({}, jiffClient.options.initialization);
  
  /*
   * Connection and initialization must be carried out with the server, and
   * with the external crypto provider if configured.
   */
  if (jiffClient.external_crypto_provider) {
    jiffClient.external_crypto_provider_connected = new jiffClient.helpers.Deferred();
    jiffClient.external_crypto_provider_initialized = new jiffClient.helpers.Deferred();
    
    jiffClient.handlers.crypto_provider_connected = function () {
      jiffClient.external_crypto_provider_connected.resolve();
    }
    jiffClient.handlers.crypto_provider_initialized = function () {
      jiffClient.external_crypto_provider_initialized.resolve();
    }
  }

  /**
   * Called when an error occurs
   * @method
   * @memberof handlers
   * @param {string} label - the name of message or operation causing the error
   * @param {error|string} error - the error
   */
  jiffClient.handlers.error = function (label, error) {
    if (jiffClient.options.onError) {
      jiffClient.options.onError(label, error);
    }

    console.log(jiffClient.id, ':', 'Error from server:', label, '---', error); // TODO: remove debugging
    if (label === 'initialization') {
      jiffClient.socket.disconnect();

      if (jiffClient.initialization_counter < jiffClient.options.maxInitializationRetries) {
        console.log(jiffClient.id, ':', 'reconnecting..'); // TODO: remove debugging
        setTimeout(jiffClient.connect, jiffClient.options.socketOptions.reconnectionDelay);
      }
    }
  };

  /**
   * Builds the initialization message for this instance
   * @method
   * @memberof handlers
   * @return {Object}
   */
  jiffClient.handlers.build_initialization_message = function () {
    var msg = {
      computation_id: jiffClient.computation_id,
      party_id: jiffClient.id,
      party_count: jiffClient.party_count,
      public_key: jiffClient.public_key != null ? jiffClient.hooks.dumpKey(jiffClient, jiffClient.public_key) : undefined
    };
    msg = Object.assign(msg, jiffClient.options.initialization);

    // Initialization Hook
    return jiffClient.hooks.execute_array_hooks('beforeOperation', [jiffClient, 'initialization', msg], 2);
  };

  /**
   * Begins initialization of this instance by sending the initialization message to the server.
   * Should only be called after connection is established.
   * Do not call this manually unless you know what you are doing, use <jiff_instance>.connect() instead!
   * @method
   * @memberof handlers
   */
  jiffClient.handlers.connected = function () {
    console.log('Connected!', jiffClient.id); // TODO: remove debugging
    jiffClient.initialization_counter++;

    if (jiffClient.secret_key == null && jiffClient.public_key == null) {
      var key = jiffClient.hooks.generateKeyPair(jiffClient);
      jiffClient.secret_key = key.secret_key;
      jiffClient.public_key = key.public_key;
    }

    // Initialization message
    jiffClient.initialization_msg = jiffClient.handlers.build_initialization_message();

    // Emit initialization message to server
    jiffClient.socket.emit('initialization', JSON.stringify(jiffClient.initialization_msg));
  };

  /**
   * Called after the server approves initialization of this instance.
   * Sets the instance id, the count of parties in the computation, and the public keys
   * of initialized parties.
   * @method
   * @memberof handlers
   */
  jiffClient.handlers.initialized = function (msg) {
    jiffClient.__initialized = true;
    jiffClient.initialization_counter = 0;

    msg = JSON.parse(msg);
    msg = jiffClient.hooks.execute_array_hooks('afterOperation', [jiffClient, 'initialization', msg], 2);

    jiffClient.id = msg.party_id;
    jiffClient.party_count = msg.party_count;

    // Initialize with external crypto provide.
    if (jiffClient.external_crypto_provider) {
      if (jiffClient.initialization_msg == null) {
        jiffClient.initialization_msg = jiffClient.handlers.build_initialization_message();
      }
      jiffClient.initialization_msg.party_id = jiffClient.id;
      jiffClient.initialization_msg.party_count = jiffClient.party_count;
      jiffClient.external_crypto_provider_connected.promise.then(function () {
        jiffClient.crypto_provider_socket.emit('initialization', JSON.stringify(jiffClient.initialization_msg));
      });
    }

    // Now: (1) this party is connect (2) server (and other parties) know this public key
    // Resend all pending messages
    jiffClient.socket.resend_mailbox();

    // store the received public keys and resolve wait callbacks
    if (jiffClient.external_crypto_provider) {
      jiffClient.external_crypto_provider_initialized.promise.then(function () {
        jiffClient.handlers.store_public_keys(msg.public_keys);
      });
    } else {
      jiffClient.handlers.store_public_keys(msg.public_keys);
    }
  };

  /**
   * Parse and store the given public keys
   * @method
   * @memberof handlers
   * @param {object} keymap - maps party id to serialized public key.
   */
  jiffClient.handlers.store_public_keys = function (keymap) {
    var i;
    for (i in keymap) {
      if (keymap.hasOwnProperty(i) && jiffClient.keymap[i] == null) {
        jiffClient.keymap[i] = jiffClient.hooks.parseKey(jiffClient, keymap[i]);
      }
    }

    // Resolve any pending messages that were received before the sender's public key was known
    jiffClient.resolve_messages_waiting_for_keys();

    // Resolve any pending waits that have satisfied conditions
    jiffClient.execute_wait_callbacks();

    // Check if all keys have been received
    if (jiffClient.keymap['s1'] == null) {
      return;
    }
    for (i = 1; i <= jiffClient.party_count; i++) {
      if (jiffClient.keymap[i] == null) {
        return;
      }
    }

    // all parties are connected; execute callback
    if (jiffClient.__ready !== true && jiffClient.__initialized) {
      jiffClient.__ready = true;
      if (jiffClient.options.onConnect != null) {
        jiffClient.options.onConnect(jiffClient);
      }
    }
  };
};

},{}],5:[function(require,module,exports){
// adds sharing related handlers
module.exports = function (jiffClient) {
  /**
   * Store the received share and resolves the corresponding
   * deferred if needed.
   * @method
   * @memberof handlers
   * @param {object} json_msg - the parsed json message as received.
   */
  jiffClient.handlers.receive_share = function (json_msg) {
    // Decrypt share
    let decrypted = jiffClient.hooks.decryptSign(jiffClient, json_msg['share'], jiffClient.secret_key, jiffClient.keymap[json_msg['party_id']]);
    
    var ready = function (decrypted) {
      json_msg['share'] = decrypted;
      json_msg = jiffClient.hooks.execute_array_hooks('afterOperation', [jiffClient, 'share', json_msg], 2);

      var sender_id = json_msg['party_id'];
      var op_id = json_msg['op_id'];
      var share = json_msg['share'];

      // Call hook
      share = jiffClient.hooks.execute_array_hooks('receiveShare', [jiffClient, sender_id, share], 2);

      // check if a deferred is set up (maybe the share was received early)
      if (jiffClient.deferreds[op_id] == null) {
        jiffClient.deferreds[op_id] = {};
      }
      if (jiffClient.deferreds[op_id][sender_id] == null) {
        // Share is received before deferred was setup, store it.
        jiffClient.deferreds[op_id][sender_id] = new jiffClient.helpers.Deferred();
      }

      // Deferred is already setup, resolve it.
      jiffClient.deferreds[op_id][sender_id].resolve(share);
    }

    if (decrypted.then) {
      decrypted.then(ready);
    } else {
      ready(decrypted);
    }
  };

  /**
   * Resolves the deferred corresponding to operation_id and sender_id.
   * @method
   * @memberof handlers
   * @param {object} json_msg - the json message as received with the open event.
   */
  jiffClient.handlers.receive_open = function (json_msg) {
    // Decrypt share
    if (json_msg['party_id'] !== jiffClient.id) {
      var decrypted = jiffClient.hooks.decryptSign(jiffClient, json_msg['share'], jiffClient.secret_key, jiffClient.keymap[json_msg['party_id']]);
    }

    var ready = function (decrypted) {
      if (json_msg['party_id'] !== jiffClient.id) {
        json_msg['share'] = decrypted;
        json_msg = jiffClient.hooks.execute_array_hooks('afterOperation', [jiffClient, 'open', json_msg], 2);
      }

      var sender_id = json_msg['party_id'];
      var op_id = json_msg['op_id'];
      var share = json_msg['share'];
      var Zp = json_msg['Zp'];

      // call hook
      share = jiffClient.hooks.execute_array_hooks('receiveOpen', [jiffClient, sender_id, share, Zp], 2);

      // Ensure deferred is setup
      if (jiffClient.deferreds[op_id] == null) {
        jiffClient.deferreds[op_id] = {};
      }
      if (jiffClient.deferreds[op_id].shares == null) {
        jiffClient.deferreds[op_id].shares = [];
      }

      // Accumulate received shares
      jiffClient.deferreds[op_id].shares.push({value: share, sender_id: sender_id, Zp: Zp});

      // Resolve when ready
      if (jiffClient.deferreds[op_id].shares.length === jiffClient.deferreds[op_id].threshold) {
        jiffClient.deferreds[op_id].deferred.resolve();
      }

      // Clean up if done
      if (jiffClient.deferreds[op_id] != null && jiffClient.deferreds[op_id].deferred === 'CLEAN' && jiffClient.deferreds[op_id].shares.length === jiffClient.deferreds[op_id].total) {
        delete jiffClient.deferreds[op_id];
      }
    }

    if (decrypted != null && decrypted.then) {
      decrypted.then(ready);
    } else if (decrypted != null) {
      ready(decrypted);
    } else {
      ready(json_msg['share']);
    }
  }
};
},{}],6:[function(require,module,exports){
/** Doubly linked list with add and remove functions and pointers to head and tail**/
module.exports = function () {
  // attributes: list.head and list.tail
  // functions: list.add(object) (returns pointer), list.remove(pointer)
  // list.head/list.tail/any element contains:
  //    next: pointer to next,
  //    previous: pointer to previous,
  //    object: stored object.
  var list = {head: null, tail: null};
  // TODO rename this to pushTail || push
  list.add = function (obj) {
    var node = { object: obj, next: null, previous: null };
    if (list.head == null) {
      list.head = node;
      list.tail = node;
    } else {
      list.tail.next = node;
      node.previous = list.tail;
      list.tail = node;
    }
    return node;
  };

  list.pushHead = function (obj) {
    list.head = {object: obj, next : list.head, previous : null};
    if (list.head.next != null) {
      list.head.next.previous = list.head;
    } else {
      list.tail = list.head;
    }
  };

  list.popHead = function () {
    var result = list.head;
    if (list.head != null) {
      list.head = list.head.next;
      if (list.head == null) {
        list.tail = null;
      } else {
        list.head.previous  = null;
      }
    }
    return result;
  };

  // merges two linked lists and return a pointer to the head of the merged list
  // the head will be the head of list and the tail the tail of l2
  list.extend = function (l2) {
    if (list.head == null) {
      return l2;
    }
    if (l2.head == null) {
      return list;
    }
    list.tail.next = l2.head;
    l2.head.previous = list.tail;
    list.tail = l2.tail;

    return list;
  };

  list.remove = function (ptr) {
    var prev = ptr.previous;
    var next = ptr.next;

    if (prev == null && list.head !== ptr) {
      return;
    } else if (next == null && list.tail !== ptr) {
      return;
    }

    if (prev == null) { // ptr is head (or both head and tail)
      list.head = next;
      if (list.head != null) {
        list.head.previous = null;
      } else {
        list.tail = null;
      }
    } else if (next == null) { // ptr is tail (and not head)
      list.tail = prev;
      prev.next = null;
    } else { // ptr is inside
      prev.next = next;
      next.previous = prev;
    }
  };
  list.slice = function (ptr) { // remove all elements from head to ptr (including ptr).
    if (ptr == null) {
      return;
    }

    /* CONSERVATIVE: make sure ptr is part of the list then remove */
    var current = list.head;
    while (current != null) {
      if (current === ptr) {
        list.head = ptr.next;
        if (list.head == null) {
          list.tail = null;
        }

        return;
      }
      current = current.next;
    }

    /* MORE AGGRESSIVE VERSION: will be incorrect if ptr is not in the list */
    /*
    list.head = ptr.next;
    if (list.head == null) {
      list.tail = null;
    }
    */
  };
  /*
  list._debug_length = function () {
    var l = 0;
    var current = list.head;
    while (current != null) {
      current = current.next;
      l++;
    }
    return l;
  };
  */
  return list;
};

},{}],7:[function(require,module,exports){
(function (process,global){(function (){
/**
 * This defines a library extension for using websockets rather than socket.io for communication. This
 * extension primarily edits/overwrites existing socket functions to use and be compatible with the
 * ws library.
 * @namespace jiffclient_websockets
 * @version 1.0
 *
 * REQUIREMENTS:
 * You must apply this extension to your client and the server you're communicating with must apply jiffserver_websockets.
 * When using this extension in browser, "/dist/jiff-client-websockets.js" must be loaded in client.html instead of this file.
 */



(function (exports, node) {
  /**
   * The name of this extension: 'websocket'
   * @type {string}
   * @memberOf jiffclient_websockets
   */

  var ws;
  var linkedList;
  var handlers;

  linkedList = require('../common/linkedlist.js');
  handlers = require('../client/handlers.js');
  if (!process.browser) {
    ws = require('ws');
  } else {
    if (typeof WebSocket !== 'undefined') {
      ws = WebSocket
    } else if (typeof MozWebSocket !== 'undefined') {
      ws = MozWebSocket
    } else if (typeof global !== 'undefined') {
      ws = global.WebSocket || global.MozWebSocket
    } else if (typeof window !== 'undefined') {
      ws = window.WebSocket || window.MozWebSocket
    } else if (typeof self !== 'undefined') {
      ws = self.WebSocket || self.MozWebSocket
    }
  }


  // Take the jiff-client base instance and options for this extension, and use them
  // to construct an instance for this extension.
  function make_jiff(base_instance, options) {
    var jiff = base_instance;

    // Parse options
    if (options == null) {
      options = {};
    }

    /* Functions that overwrite client/socket/events.js functionality */

    /**
     * initSocket's '.on' functions needed to be replaced since ws does
     * not have as many protocols. Instead these functions are routed to
     * when a message is received and a protocol is manually parsed.
     */
    jiff.initSocket = function () {
      var jiffClient = this;

      /* ws uses the 'open' protocol on connection. Should not conflict with the
           JIFF open protocl as that will be sent as a message and ws
           will see it as a 'message' protocol. */
      this.socket.onopen = jiffClient.handlers.connected;

      // Public keys were updated on the server, and it sent us the updates
      function publicKeysChanged(msg, callback) {

        msg = JSON.parse(msg);
        msg = jiffClient.hooks.execute_array_hooks('afterOperation', [jiffClient, 'public_keys', msg], 2);

        jiffClient.handlers.store_public_keys(msg.public_keys);
      }

      // Setup receiving matching shares
      function share(msg, callback) {

        // parse message
        var json_msg = JSON.parse(msg);
        var sender_id = json_msg['party_id'];

        if (jiffClient.keymap[sender_id] != null) {
          jiffClient.handlers.receive_share(json_msg);
        } else {
          if (jiffClient.messagesWaitingKeys[sender_id] == null) {
            jiffClient.messagesWaitingKeys[sender_id] = [];
          }
          jiffClient.messagesWaitingKeys[sender_id].push({ label: 'share', msg: json_msg });
        }
      }

      function mpcOpen(msg, callback) {
        // parse message
        var json_msg = JSON.parse(msg);
        var sender_id = json_msg['party_id'];

        if (jiffClient.keymap[sender_id] != null) {
          jiffClient.handlers.receive_open(json_msg);
        } else {
          if (jiffClient.messagesWaitingKeys[sender_id] == null) {
            jiffClient.messagesWaitingKeys[sender_id] = [];
          }
          jiffClient.messagesWaitingKeys[sender_id].push({ label: 'open', msg: json_msg });
        }
      }

      // handle custom messages
      function socketCustom(msg, callback) {
        var json_msg = JSON.parse(msg);
        var sender_id = json_msg['party_id'];
        var encrypted = json_msg['encrypted'];

        if (jiffClient.keymap[sender_id] != null || encrypted !== true) {
          jiffClient.handlers.receive_custom(json_msg);
        } else {
          // key must not exist yet for sender_id, and encrypted must be true
          if (jiffClient.messagesWaitingKeys[sender_id] == null) {
            jiffClient.messagesWaitingKeys[sender_id] = [];
          }
          jiffClient.messagesWaitingKeys[sender_id].push({ label: 'custom', msg: json_msg });
        }
      }

      function cryptoProvider(msg, callback) {
        jiffClient.handlers.receive_crypto_provider(JSON.parse(msg));
      }

      function onError(msg) {
        try {
          msg = JSON.parse(msg);
          jiffClient.handlers.error(msg['label'], msg['error']);
        } catch (error) {
          jiffClient.handlers.error('socket.io', msg);
        }
      }

      function socketClose(reason) {
        if (reason !== 'io client disconnect') {
          // check that the reason is an error and not a user initiated disconnect
          console.log('Disconnected!', jiffClient.id, reason);
        }

        jiffClient.hooks.execute_array_hooks('afterOperation', [jiffClient, 'disconnect', reason], -1);
      }

      this.socket.onclose = function (reason) {
        socketClose(reason.code);
      }

      /**
       * In every message sent over ws, we will send along with it a socketProtocol string
       * that will be parsed by the receiver to route the request to the correct function. The
       * previous information sent by socket.io will be untouched, but now sent inside of msg.data.
       */
      this.socket.onmessage = function (msg, callback) {
        msg = JSON.parse(msg.data);

        switch (msg.socketProtocol) {
          case 'initialization':
            jiffClient.handlers.initialized(msg.data);
            break;
          case 'public_keys':
            publicKeysChanged(msg.data, callback);
            break;
          case 'share':
            share(msg.data, callback);
            break;
          case 'open':
            mpcOpen(msg.data, callback);
            break;
          case 'custom':
            socketCustom(msg.data, callback);
            break;
          case 'crypto_provider':
            cryptoProvider(msg.data, callback);
            break;
          case 'close':
            socketClose(msg.data);
            break;
          case 'disconnect':
            socketClose(msg.data);
            break;
          case 'error':
            onError(msg.data);
            break;
          default:
            console.log('Uknown protocol, ' + msg.socketProtocol + ', received');
        }
      }

    };

    /* Overwrite the socketConnect function from jiff-client.js */

    jiff.socketConnect = function (JIFFClientInstance) {

      if (options.__internal_socket == null) {
        /**
         * Socket wrapper between this instance and the server, based on sockets.io
         * @type {!GuardedSocket}
         */
        JIFFClientInstance.socket = guardedSocket(JIFFClientInstance);
      } else {
        JIFFClientInstance.socket = internalSocket(JIFFClientInstance, options.__internal_socket);
      }

      // set up socket event handlers
      handlers(JIFFClientInstance);

      // Overwrite handlers.connected with our new ws connection handler
      JIFFClientInstance.handlers.connected = function () {
        JIFFClientInstance.initialization_counter++;

        if (JIFFClientInstance.secret_key == null && JIFFClientInstance.public_key == null) {
          var key = JIFFClientInstance.hooks.generateKeyPair(JIFFClientInstance);
          JIFFClientInstance.secret_key = key.secret_key;
          JIFFClientInstance.public_key = key.public_key;
        }

        // Initialization message
        var msg = JIFFClientInstance.handlers.build_initialization_message();

        // Double wrap the msg
        msg = JSON.stringify(msg);

        // Emit initialization message to server
        JIFFClientInstance.socket.send(JSON.stringify({ socketProtocol: 'initialization', data: msg }));
      };


      JIFFClientInstance.initSocket();
    }

    /* Functions that overwrite client/socket/mailbox.js functionality */

    function guardedSocket(jiffClient) {
      // Create plain socket io object which we will wrap in this
      var socket;
      if (jiffClient.hostname.startsWith("http")) {
        var modifiedHostName = "ws" + jiffClient.hostname.substring(jiffClient.hostname.indexOf(":"))
        socket = new ws(modifiedHostName)
      } else {
        socket = new ws(jiffClient.hostname);
      }


      socket.old_disconnect = socket.close;

      socket.mailbox = linkedList(); // for outgoing messages
      socket.empty_deferred = null; // gets resolved whenever the mailbox is empty
      socket.jiffClient = jiffClient;

      // add functionality to socket
      socket.safe_emit = safe_emit.bind(socket);
      socket.resend_mailbox = resend_mailbox.bind(socket);
      socket.disconnect = disconnect.bind(socket);
      socket.safe_disconnect = safe_disconnect.bind(socket);
      socket.is_empty = is_empty.bind(socket);

      return socket;
    }

    function safe_emit(label, msg) {
      // add message to mailbox
      var mailbox_pointer = this.mailbox.add({ label: label, msg: msg });
      if (this.readyState === 1) {
        var self = this;
        // emit the message, if an acknowledgment is received, remove it from mailbox

        this.send(JSON.stringify({ socketProtocol: label, data: msg }), null, function (status) {

          self.mailbox.remove(mailbox_pointer);

          if (self.is_empty() && self.empty_deferred != null) {
            self.empty_deferred.resolve();
          }

          if (label === 'free') {
            self.jiffClient.hooks.execute_array_hooks('afterOperation', [self.jiffClient, 'free', msg], 2);
          }
        });
      }

    }

    function resend_mailbox() {
      // Create a new mailbox, since the current mailbox will be resent and
      // will contain new backups.
      var old_mailbox = this.mailbox;
      this.mailbox = linkedList();

      // loop over all stored messages and emit them
      var current_node = old_mailbox.head;
      while (current_node != null) {
        var label = current_node.object.label;
        var msg = current_node.object.msg;
        this.safe_emit(label, msg);
        current_node = current_node.next;
      }

    }

    function disconnect() {

      this.jiffClient.hooks.execute_array_hooks('beforeOperation', [this.jiffClient, 'disconnect', {}], -1);


      this.old_disconnect.apply(this, arguments);
    }

    function safe_disconnect(free, callback) {

      if (this.is_empty()) {

        if (free) {
          this.jiffClient.free();
          free = false;
        } else {
          // T: Should remain "disconnect" since we override the .disconnect, no need to change to close
          this.disconnect();
          if (callback != null) {
            callback();
          }
          return;
        }
      }

      this.empty_deferred = new this.jiffClient.helpers.Deferred();
      this.empty_deferred.promise.then(this.safe_disconnect.bind(this, free, callback));

    }

    function is_empty() {
      return this.mailbox.head == null && this.jiffClient.counters.pending_opens === 0;

    }

    /* PREPROCESSING IS THE SAME */
    jiff.preprocessing_function_map[exports.name] = {};


    return jiff;
  }
  // Expose the API for this extension.
  exports.make_jiff = make_jiff;

}((typeof exports === 'undefined' ? this.jiff_websockets = {} : exports), typeof exports !== 'undefined'));

}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../client/handlers.js":1,"../common/linkedlist.js":6,"_process":8,"ws":9}],8:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],9:[function(require,module,exports){
'use strict';

module.exports = function () {
  throw new Error(
    'ws does not work in the browser. Browser clients must use the native ' +
      'WebSocket object'
  );
};

},{}]},{},[7])(7)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvY2xpZW50L2hhbmRsZXJzLmpzIiwibGliL2NsaWVudC9oYW5kbGVycy9jcnlwdG9fcHJvdmlkZXIuanMiLCJsaWIvY2xpZW50L2hhbmRsZXJzL2N1c3RvbS5qcyIsImxpYi9jbGllbnQvaGFuZGxlcnMvaW5pdGlhbGl6YXRpb24uanMiLCJsaWIvY2xpZW50L2hhbmRsZXJzL3NoYXJpbmcuanMiLCJsaWIvY29tbW9uL2xpbmtlZGxpc3QuanMiLCJsaWIvZXh0L2ppZmYtY2xpZW50LXdlYnNvY2tldHMuanMiLCJub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3dzL2Jyb3dzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM5SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUMvVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwidmFyIGluaXRpYWxpemF0aW9uSGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzL2luaXRpYWxpemF0aW9uLmpzJyk7XG52YXIgc2hhcmVIYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMvc2hhcmluZy5qcycpO1xudmFyIGN1c3RvbUhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycy9jdXN0b20uanMnKTtcbnZhciBjcnlwdG9Qcm92aWRlckhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycy9jcnlwdG9fcHJvdmlkZXIuanMnKTtcblxuLyoqXG4gKiBDb250YWlucyBoYW5kbGVycyBmb3IgY29tbXVuaWNhdGlvbiBldmVudHNcbiAqIEBuYW1lIGhhbmRsZXJzXG4gKiBAYWxpYXMgaGFuZGxlcnNcbiAqIEBuYW1lc3BhY2VcbiAqL1xuXG4vLyBBZGQgaGFuZGxlcnMgaW1wbGVtZW50YXRpb25zXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChqaWZmQ2xpZW50KSB7XG4gIC8vIGZpbGwgaW4gaGFuZGxlcnNcbiAgaW5pdGlhbGl6YXRpb25IYW5kbGVycyhqaWZmQ2xpZW50KTtcbiAgc2hhcmVIYW5kbGVycyhqaWZmQ2xpZW50KTtcbiAgY3VzdG9tSGFuZGxlcnMoamlmZkNsaWVudCk7XG4gIGNyeXB0b1Byb3ZpZGVySGFuZGxlcnMoamlmZkNsaWVudCk7XG59OyIsIi8vIHNldHVwIGhhbmRsZXIgZm9yIHJlY2VpdmluZyBtZXNzYWdlcyBmcm9tIHRoZSBjcnlwdG8gcHJvdmlkZXJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGppZmZDbGllbnQpIHtcbiAgLyoqXG4gICAqIFBhcnNlIGNyeXB0byBwcm92aWRlciBtZXNzYWdlIGFuZCByZXNvbHZlIGFzc29jaWF0ZWQgcHJvbWlzZS5cbiAgICogQG1ldGhvZFxuICAgKiBAbWVtYmVyb2YgaGFuZGxlcnNcbiAgICogQHBhcmFtIHtvYmplY3R9IGpzb25fbXNnIC0gdGhlIHBhcnNlZCBqc29uIG1lc3NhZ2UgYXMgcmVjZWl2ZWQgYnkgdGhlIGNyeXB0b19wcm92aWRlciBldmVudCwgY29udGFpbnMgJ3ZhbHVlcycgYW5kICdzaGFyZXMnIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBqaWZmQ2xpZW50LmhhbmRsZXJzLnJlY2VpdmVfY3J5cHRvX3Byb3ZpZGVyID0gZnVuY3Rpb24gKGpzb25fbXNnKSB7XG4gICAgLy8gSG9va1xuICAgIGpzb25fbXNnID0gamlmZkNsaWVudC5ob29rcy5leGVjdXRlX2FycmF5X2hvb2tzKCdhZnRlck9wZXJhdGlvbicsIFtqaWZmQ2xpZW50LCAnY3J5cHRvX3Byb3ZpZGVyJywganNvbl9tc2ddLCAyKTtcblxuICAgIHZhciBvcF9pZCA9IGpzb25fbXNnWydvcF9pZCddO1xuICAgIGlmIChqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF0gPT0gbnVsbCkge1xuICAgICAgcmV0dXJuOyAvLyBkdXBsaWNhdGUgbWVzc2FnZTogaWdub3JlXG4gICAgfVxuXG4gICAgLy8gcGFyc2UgbXNnXG4gICAgdmFyIHJlY2VpdmVyc19saXN0ID0ganNvbl9tc2dbJ3JlY2VpdmVycyddO1xuICAgIHZhciB0aHJlc2hvbGQgPSBqc29uX21zZ1sndGhyZXNob2xkJ107XG4gICAgdmFyIFpwID0ganNvbl9tc2dbJ1pwJ107XG5cbiAgICAvLyBjb25zdHJ1Y3Qgc2VjcmV0IHNoYXJlIG9iamVjdHNcbiAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgaWYgKGpzb25fbXNnWyd2YWx1ZXMnXSAhPSBudWxsKSB7XG4gICAgICByZXN1bHQudmFsdWVzID0ganNvbl9tc2dbJ3ZhbHVlcyddO1xuICAgIH1cbiAgICBpZiAoanNvbl9tc2dbJ3NoYXJlcyddICE9IG51bGwpIHtcbiAgICAgIHJlc3VsdC5zaGFyZXMgPSBbXTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwganNvbl9tc2dbJ3NoYXJlcyddLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHJlc3VsdC5zaGFyZXMucHVzaChuZXcgamlmZkNsaWVudC5TZWNyZXRTaGFyZShqc29uX21zZ1snc2hhcmVzJ11baV0sIHJlY2VpdmVyc19saXN0LCB0aHJlc2hvbGQsIFpwKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gcmVzb2x2ZSBkZWZlcnJlZFxuICAgIGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXS5yZXNvbHZlKHJlc3VsdCk7XG4gICAgZGVsZXRlIGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXTtcbiAgfTtcbn07IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoamlmZkNsaWVudCkge1xuICAvKipcbiAgICogQ2FsbGVkIHdoZW4gdGhpcyBwYXJ0eSByZWNlaXZlcyBhIGN1c3RvbSB0YWcgbWVzc2FnZSBmcm9tIGFueSBwYXJ0eSAoaW5jbHVkaW5nIGl0c2VsZikuXG4gICAqIElmIGEgY3VzdG9tIGxpc3RlbmVyIHdhcyBzZXR1cCB0byBsaXN0ZW4gdG8gdGhlIHRhZywgdGhlIG1lc3NhZ2UgaXMgcGFzc2VkIHRvIHRoZSBsaXN0ZW5lci5cbiAgICogT3RoZXJ3aXNlLCB0aGUgbWVzc2FnZSBpcyBzdG9yZWQgdW50aWwgc3VjaCBhIGxpc3RlbmVyIGlzIHByb3ZpZGVkLlxuICAgKiBAbWV0aG9kXG4gICAqIEBtZW1iZXJvZiBoYW5kbGVyc1xuICAgKiBAcGFyYW0ge29iamVjdH0ganNvbl9tc2cgLSB0aGUgcGFyc2VkIGpzb24gbWVzc2FnZSBhcyByZWNlaXZlZCBieSB0aGUgY3VzdG9tIGV2ZW50LlxuICAgKi9cbiAgamlmZkNsaWVudC5oYW5kbGVycy5yZWNlaXZlX2N1c3RvbSA9IGZ1bmN0aW9uIChqc29uX21zZykge1xuICAgIGlmIChqc29uX21zZ1sncGFydHlfaWQnXSAhPT0gamlmZkNsaWVudC5pZCkge1xuICAgICAgaWYgKGpzb25fbXNnWydlbmNyeXB0ZWQnXSA9PT0gdHJ1ZSkge1xuICAgICAgICB2YXIgZGVjcnlwdGVkID0gamlmZkNsaWVudC5ob29rcy5kZWNyeXB0U2lnbihqaWZmQ2xpZW50LCBqc29uX21zZ1snbWVzc2FnZSddLCBqaWZmQ2xpZW50LnNlY3JldF9rZXksIGppZmZDbGllbnQua2V5bWFwW2pzb25fbXNnWydwYXJ0eV9pZCddXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHJlYWR5ID0gZnVuY3Rpb24gKGRlY3J5cHRlZCkge1xuICAgICAgaWYgKGpzb25fbXNnWydwYXJ0eV9pZCddICE9PSBqaWZmQ2xpZW50LmlkKSB7XG4gICAgICAgIGlmIChqc29uX21zZ1snZW5jcnlwdGVkJ10gPT09IHRydWUpIHtcbiAgICAgICAgICBqc29uX21zZ1snbWVzc2FnZSddID0gZGVjcnlwdGVkO1xuICAgICAgICB9XG4gICAgICAgIGpzb25fbXNnID0gamlmZkNsaWVudC5ob29rcy5leGVjdXRlX2FycmF5X2hvb2tzKCdhZnRlck9wZXJhdGlvbicsIFtqaWZmQ2xpZW50LCAnY3VzdG9tJywganNvbl9tc2ddLCAyKTtcbiAgICAgIH1cblxuICAgICAgdmFyIHNlbmRlcl9pZCA9IGpzb25fbXNnWydwYXJ0eV9pZCddO1xuICAgICAgdmFyIHRhZyA9IGpzb25fbXNnWyd0YWcnXTtcbiAgICAgIHZhciBtZXNzYWdlID0ganNvbl9tc2dbJ21lc3NhZ2UnXTtcblxuICAgICAgaWYgKGppZmZDbGllbnQubGlzdGVuZXJzW3RhZ10gIT0gbnVsbCkge1xuICAgICAgICBqaWZmQ2xpZW50Lmxpc3RlbmVyc1t0YWddKHNlbmRlcl9pZCwgbWVzc2FnZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTdG9yZSBtZXNzYWdlIHVudGlsIGxpc3RlbmVyIGlzIHByb3ZpZGVkXG4gICAgICAgIHZhciBzdG9yZWRfbWVzc2FnZXMgPSBqaWZmQ2xpZW50LmN1c3RvbV9tZXNzYWdlc19tYWlsYm94W3RhZ107XG4gICAgICAgIGlmIChzdG9yZWRfbWVzc2FnZXMgPT0gbnVsbCkge1xuICAgICAgICAgIHN0b3JlZF9tZXNzYWdlcyA9IFtdO1xuICAgICAgICAgIGppZmZDbGllbnQuY3VzdG9tX21lc3NhZ2VzX21haWxib3hbdGFnXSA9IHN0b3JlZF9tZXNzYWdlcztcbiAgICAgICAgfVxuXG4gICAgICAgIHN0b3JlZF9tZXNzYWdlcy5wdXNoKHtzZW5kZXJfaWQ6IHNlbmRlcl9pZCwgbWVzc2FnZTogbWVzc2FnZX0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChkZWNyeXB0ZWQgIT0gbnVsbCAmJiBkZWNyeXB0ZWQudGhlbikge1xuICAgICAgZGVjcnlwdGVkLnRoZW4ocmVhZHkpO1xuICAgIH0gZWxzZSBpZiAoZGVjcnlwdGVkICE9IG51bGwpIHtcbiAgICAgIHJlYWR5KGRlY3J5cHRlZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlYWR5KGpzb25fbXNnWydtZXNzYWdlJ10pO1xuICAgIH1cbiAgfVxufTsiLCIvLyBhZGQgaGFuZGxlcnMgZm9yIGluaXRpYWxpemF0aW9uXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChqaWZmQ2xpZW50KSB7XG4gIGppZmZDbGllbnQub3B0aW9ucy5pbml0aWFsaXphdGlvbiA9IE9iamVjdC5hc3NpZ24oe30sIGppZmZDbGllbnQub3B0aW9ucy5pbml0aWFsaXphdGlvbik7XG4gIFxuICAvKlxuICAgKiBDb25uZWN0aW9uIGFuZCBpbml0aWFsaXphdGlvbiBtdXN0IGJlIGNhcnJpZWQgb3V0IHdpdGggdGhlIHNlcnZlciwgYW5kXG4gICAqIHdpdGggdGhlIGV4dGVybmFsIGNyeXB0byBwcm92aWRlciBpZiBjb25maWd1cmVkLlxuICAgKi9cbiAgaWYgKGppZmZDbGllbnQuZXh0ZXJuYWxfY3J5cHRvX3Byb3ZpZGVyKSB7XG4gICAgamlmZkNsaWVudC5leHRlcm5hbF9jcnlwdG9fcHJvdmlkZXJfY29ubmVjdGVkID0gbmV3IGppZmZDbGllbnQuaGVscGVycy5EZWZlcnJlZCgpO1xuICAgIGppZmZDbGllbnQuZXh0ZXJuYWxfY3J5cHRvX3Byb3ZpZGVyX2luaXRpYWxpemVkID0gbmV3IGppZmZDbGllbnQuaGVscGVycy5EZWZlcnJlZCgpO1xuICAgIFxuICAgIGppZmZDbGllbnQuaGFuZGxlcnMuY3J5cHRvX3Byb3ZpZGVyX2Nvbm5lY3RlZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIGppZmZDbGllbnQuZXh0ZXJuYWxfY3J5cHRvX3Byb3ZpZGVyX2Nvbm5lY3RlZC5yZXNvbHZlKCk7XG4gICAgfVxuICAgIGppZmZDbGllbnQuaGFuZGxlcnMuY3J5cHRvX3Byb3ZpZGVyX2luaXRpYWxpemVkID0gZnVuY3Rpb24gKCkge1xuICAgICAgamlmZkNsaWVudC5leHRlcm5hbF9jcnlwdG9fcHJvdmlkZXJfaW5pdGlhbGl6ZWQucmVzb2x2ZSgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgd2hlbiBhbiBlcnJvciBvY2N1cnNcbiAgICogQG1ldGhvZFxuICAgKiBAbWVtYmVyb2YgaGFuZGxlcnNcbiAgICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gdGhlIG5hbWUgb2YgbWVzc2FnZSBvciBvcGVyYXRpb24gY2F1c2luZyB0aGUgZXJyb3JcbiAgICogQHBhcmFtIHtlcnJvcnxzdHJpbmd9IGVycm9yIC0gdGhlIGVycm9yXG4gICAqL1xuICBqaWZmQ2xpZW50LmhhbmRsZXJzLmVycm9yID0gZnVuY3Rpb24gKGxhYmVsLCBlcnJvcikge1xuICAgIGlmIChqaWZmQ2xpZW50Lm9wdGlvbnMub25FcnJvcikge1xuICAgICAgamlmZkNsaWVudC5vcHRpb25zLm9uRXJyb3IobGFiZWwsIGVycm9yKTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhqaWZmQ2xpZW50LmlkLCAnOicsICdFcnJvciBmcm9tIHNlcnZlcjonLCBsYWJlbCwgJy0tLScsIGVycm9yKTsgLy8gVE9ETzogcmVtb3ZlIGRlYnVnZ2luZ1xuICAgIGlmIChsYWJlbCA9PT0gJ2luaXRpYWxpemF0aW9uJykge1xuICAgICAgamlmZkNsaWVudC5zb2NrZXQuZGlzY29ubmVjdCgpO1xuXG4gICAgICBpZiAoamlmZkNsaWVudC5pbml0aWFsaXphdGlvbl9jb3VudGVyIDwgamlmZkNsaWVudC5vcHRpb25zLm1heEluaXRpYWxpemF0aW9uUmV0cmllcykge1xuICAgICAgICBjb25zb2xlLmxvZyhqaWZmQ2xpZW50LmlkLCAnOicsICdyZWNvbm5lY3RpbmcuLicpOyAvLyBUT0RPOiByZW1vdmUgZGVidWdnaW5nXG4gICAgICAgIHNldFRpbWVvdXQoamlmZkNsaWVudC5jb25uZWN0LCBqaWZmQ2xpZW50Lm9wdGlvbnMuc29ja2V0T3B0aW9ucy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGluaXRpYWxpemF0aW9uIG1lc3NhZ2UgZm9yIHRoaXMgaW5zdGFuY2VcbiAgICogQG1ldGhvZFxuICAgKiBAbWVtYmVyb2YgaGFuZGxlcnNcbiAgICogQHJldHVybiB7T2JqZWN0fVxuICAgKi9cbiAgamlmZkNsaWVudC5oYW5kbGVycy5idWlsZF9pbml0aWFsaXphdGlvbl9tZXNzYWdlID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBtc2cgPSB7XG4gICAgICBjb21wdXRhdGlvbl9pZDogamlmZkNsaWVudC5jb21wdXRhdGlvbl9pZCxcbiAgICAgIHBhcnR5X2lkOiBqaWZmQ2xpZW50LmlkLFxuICAgICAgcGFydHlfY291bnQ6IGppZmZDbGllbnQucGFydHlfY291bnQsXG4gICAgICBwdWJsaWNfa2V5OiBqaWZmQ2xpZW50LnB1YmxpY19rZXkgIT0gbnVsbCA/IGppZmZDbGllbnQuaG9va3MuZHVtcEtleShqaWZmQ2xpZW50LCBqaWZmQ2xpZW50LnB1YmxpY19rZXkpIDogdW5kZWZpbmVkXG4gICAgfTtcbiAgICBtc2cgPSBPYmplY3QuYXNzaWduKG1zZywgamlmZkNsaWVudC5vcHRpb25zLmluaXRpYWxpemF0aW9uKTtcblxuICAgIC8vIEluaXRpYWxpemF0aW9uIEhvb2tcbiAgICByZXR1cm4gamlmZkNsaWVudC5ob29rcy5leGVjdXRlX2FycmF5X2hvb2tzKCdiZWZvcmVPcGVyYXRpb24nLCBbamlmZkNsaWVudCwgJ2luaXRpYWxpemF0aW9uJywgbXNnXSwgMik7XG4gIH07XG5cbiAgLyoqXG4gICAqIEJlZ2lucyBpbml0aWFsaXphdGlvbiBvZiB0aGlzIGluc3RhbmNlIGJ5IHNlbmRpbmcgdGhlIGluaXRpYWxpemF0aW9uIG1lc3NhZ2UgdG8gdGhlIHNlcnZlci5cbiAgICogU2hvdWxkIG9ubHkgYmUgY2FsbGVkIGFmdGVyIGNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQuXG4gICAqIERvIG5vdCBjYWxsIHRoaXMgbWFudWFsbHkgdW5sZXNzIHlvdSBrbm93IHdoYXQgeW91IGFyZSBkb2luZywgdXNlIDxqaWZmX2luc3RhbmNlPi5jb25uZWN0KCkgaW5zdGVhZCFcbiAgICogQG1ldGhvZFxuICAgKiBAbWVtYmVyb2YgaGFuZGxlcnNcbiAgICovXG4gIGppZmZDbGllbnQuaGFuZGxlcnMuY29ubmVjdGVkID0gZnVuY3Rpb24gKCkge1xuICAgIGNvbnNvbGUubG9nKCdDb25uZWN0ZWQhJywgamlmZkNsaWVudC5pZCk7IC8vIFRPRE86IHJlbW92ZSBkZWJ1Z2dpbmdcbiAgICBqaWZmQ2xpZW50LmluaXRpYWxpemF0aW9uX2NvdW50ZXIrKztcblxuICAgIGlmIChqaWZmQ2xpZW50LnNlY3JldF9rZXkgPT0gbnVsbCAmJiBqaWZmQ2xpZW50LnB1YmxpY19rZXkgPT0gbnVsbCkge1xuICAgICAgdmFyIGtleSA9IGppZmZDbGllbnQuaG9va3MuZ2VuZXJhdGVLZXlQYWlyKGppZmZDbGllbnQpO1xuICAgICAgamlmZkNsaWVudC5zZWNyZXRfa2V5ID0ga2V5LnNlY3JldF9rZXk7XG4gICAgICBqaWZmQ2xpZW50LnB1YmxpY19rZXkgPSBrZXkucHVibGljX2tleTtcbiAgICB9XG5cbiAgICAvLyBJbml0aWFsaXphdGlvbiBtZXNzYWdlXG4gICAgamlmZkNsaWVudC5pbml0aWFsaXphdGlvbl9tc2cgPSBqaWZmQ2xpZW50LmhhbmRsZXJzLmJ1aWxkX2luaXRpYWxpemF0aW9uX21lc3NhZ2UoKTtcblxuICAgIC8vIEVtaXQgaW5pdGlhbGl6YXRpb24gbWVzc2FnZSB0byBzZXJ2ZXJcbiAgICBqaWZmQ2xpZW50LnNvY2tldC5lbWl0KCdpbml0aWFsaXphdGlvbicsIEpTT04uc3RyaW5naWZ5KGppZmZDbGllbnQuaW5pdGlhbGl6YXRpb25fbXNnKSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIENhbGxlZCBhZnRlciB0aGUgc2VydmVyIGFwcHJvdmVzIGluaXRpYWxpemF0aW9uIG9mIHRoaXMgaW5zdGFuY2UuXG4gICAqIFNldHMgdGhlIGluc3RhbmNlIGlkLCB0aGUgY291bnQgb2YgcGFydGllcyBpbiB0aGUgY29tcHV0YXRpb24sIGFuZCB0aGUgcHVibGljIGtleXNcbiAgICogb2YgaW5pdGlhbGl6ZWQgcGFydGllcy5cbiAgICogQG1ldGhvZFxuICAgKiBAbWVtYmVyb2YgaGFuZGxlcnNcbiAgICovXG4gIGppZmZDbGllbnQuaGFuZGxlcnMuaW5pdGlhbGl6ZWQgPSBmdW5jdGlvbiAobXNnKSB7XG4gICAgamlmZkNsaWVudC5fX2luaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBqaWZmQ2xpZW50LmluaXRpYWxpemF0aW9uX2NvdW50ZXIgPSAwO1xuXG4gICAgbXNnID0gSlNPTi5wYXJzZShtc2cpO1xuICAgIG1zZyA9IGppZmZDbGllbnQuaG9va3MuZXhlY3V0ZV9hcnJheV9ob29rcygnYWZ0ZXJPcGVyYXRpb24nLCBbamlmZkNsaWVudCwgJ2luaXRpYWxpemF0aW9uJywgbXNnXSwgMik7XG5cbiAgICBqaWZmQ2xpZW50LmlkID0gbXNnLnBhcnR5X2lkO1xuICAgIGppZmZDbGllbnQucGFydHlfY291bnQgPSBtc2cucGFydHlfY291bnQ7XG5cbiAgICAvLyBJbml0aWFsaXplIHdpdGggZXh0ZXJuYWwgY3J5cHRvIHByb3ZpZGUuXG4gICAgaWYgKGppZmZDbGllbnQuZXh0ZXJuYWxfY3J5cHRvX3Byb3ZpZGVyKSB7XG4gICAgICBpZiAoamlmZkNsaWVudC5pbml0aWFsaXphdGlvbl9tc2cgPT0gbnVsbCkge1xuICAgICAgICBqaWZmQ2xpZW50LmluaXRpYWxpemF0aW9uX21zZyA9IGppZmZDbGllbnQuaGFuZGxlcnMuYnVpbGRfaW5pdGlhbGl6YXRpb25fbWVzc2FnZSgpO1xuICAgICAgfVxuICAgICAgamlmZkNsaWVudC5pbml0aWFsaXphdGlvbl9tc2cucGFydHlfaWQgPSBqaWZmQ2xpZW50LmlkO1xuICAgICAgamlmZkNsaWVudC5pbml0aWFsaXphdGlvbl9tc2cucGFydHlfY291bnQgPSBqaWZmQ2xpZW50LnBhcnR5X2NvdW50O1xuICAgICAgamlmZkNsaWVudC5leHRlcm5hbF9jcnlwdG9fcHJvdmlkZXJfY29ubmVjdGVkLnByb21pc2UudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgIGppZmZDbGllbnQuY3J5cHRvX3Byb3ZpZGVyX3NvY2tldC5lbWl0KCdpbml0aWFsaXphdGlvbicsIEpTT04uc3RyaW5naWZ5KGppZmZDbGllbnQuaW5pdGlhbGl6YXRpb25fbXNnKSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBOb3c6ICgxKSB0aGlzIHBhcnR5IGlzIGNvbm5lY3QgKDIpIHNlcnZlciAoYW5kIG90aGVyIHBhcnRpZXMpIGtub3cgdGhpcyBwdWJsaWMga2V5XG4gICAgLy8gUmVzZW5kIGFsbCBwZW5kaW5nIG1lc3NhZ2VzXG4gICAgamlmZkNsaWVudC5zb2NrZXQucmVzZW5kX21haWxib3goKTtcblxuICAgIC8vIHN0b3JlIHRoZSByZWNlaXZlZCBwdWJsaWMga2V5cyBhbmQgcmVzb2x2ZSB3YWl0IGNhbGxiYWNrc1xuICAgIGlmIChqaWZmQ2xpZW50LmV4dGVybmFsX2NyeXB0b19wcm92aWRlcikge1xuICAgICAgamlmZkNsaWVudC5leHRlcm5hbF9jcnlwdG9fcHJvdmlkZXJfaW5pdGlhbGl6ZWQucHJvbWlzZS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgamlmZkNsaWVudC5oYW5kbGVycy5zdG9yZV9wdWJsaWNfa2V5cyhtc2cucHVibGljX2tleXMpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGppZmZDbGllbnQuaGFuZGxlcnMuc3RvcmVfcHVibGljX2tleXMobXNnLnB1YmxpY19rZXlzKTtcbiAgICB9XG4gIH07XG5cbiAgLyoqXG4gICAqIFBhcnNlIGFuZCBzdG9yZSB0aGUgZ2l2ZW4gcHVibGljIGtleXNcbiAgICogQG1ldGhvZFxuICAgKiBAbWVtYmVyb2YgaGFuZGxlcnNcbiAgICogQHBhcmFtIHtvYmplY3R9IGtleW1hcCAtIG1hcHMgcGFydHkgaWQgdG8gc2VyaWFsaXplZCBwdWJsaWMga2V5LlxuICAgKi9cbiAgamlmZkNsaWVudC5oYW5kbGVycy5zdG9yZV9wdWJsaWNfa2V5cyA9IGZ1bmN0aW9uIChrZXltYXApIHtcbiAgICB2YXIgaTtcbiAgICBmb3IgKGkgaW4ga2V5bWFwKSB7XG4gICAgICBpZiAoa2V5bWFwLmhhc093blByb3BlcnR5KGkpICYmIGppZmZDbGllbnQua2V5bWFwW2ldID09IG51bGwpIHtcbiAgICAgICAgamlmZkNsaWVudC5rZXltYXBbaV0gPSBqaWZmQ2xpZW50Lmhvb2tzLnBhcnNlS2V5KGppZmZDbGllbnQsIGtleW1hcFtpXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBhbnkgcGVuZGluZyBtZXNzYWdlcyB0aGF0IHdlcmUgcmVjZWl2ZWQgYmVmb3JlIHRoZSBzZW5kZXIncyBwdWJsaWMga2V5IHdhcyBrbm93blxuICAgIGppZmZDbGllbnQucmVzb2x2ZV9tZXNzYWdlc193YWl0aW5nX2Zvcl9rZXlzKCk7XG5cbiAgICAvLyBSZXNvbHZlIGFueSBwZW5kaW5nIHdhaXRzIHRoYXQgaGF2ZSBzYXRpc2ZpZWQgY29uZGl0aW9uc1xuICAgIGppZmZDbGllbnQuZXhlY3V0ZV93YWl0X2NhbGxiYWNrcygpO1xuXG4gICAgLy8gQ2hlY2sgaWYgYWxsIGtleXMgaGF2ZSBiZWVuIHJlY2VpdmVkXG4gICAgaWYgKGppZmZDbGllbnQua2V5bWFwWydzMSddID09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChpID0gMTsgaSA8PSBqaWZmQ2xpZW50LnBhcnR5X2NvdW50OyBpKyspIHtcbiAgICAgIGlmIChqaWZmQ2xpZW50LmtleW1hcFtpXSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBhbGwgcGFydGllcyBhcmUgY29ubmVjdGVkOyBleGVjdXRlIGNhbGxiYWNrXG4gICAgaWYgKGppZmZDbGllbnQuX19yZWFkeSAhPT0gdHJ1ZSAmJiBqaWZmQ2xpZW50Ll9faW5pdGlhbGl6ZWQpIHtcbiAgICAgIGppZmZDbGllbnQuX19yZWFkeSA9IHRydWU7XG4gICAgICBpZiAoamlmZkNsaWVudC5vcHRpb25zLm9uQ29ubmVjdCAhPSBudWxsKSB7XG4gICAgICAgIGppZmZDbGllbnQub3B0aW9ucy5vbkNvbm5lY3QoamlmZkNsaWVudCk7XG4gICAgICB9XG4gICAgfVxuICB9O1xufTtcbiIsIi8vIGFkZHMgc2hhcmluZyByZWxhdGVkIGhhbmRsZXJzXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChqaWZmQ2xpZW50KSB7XG4gIC8qKlxuICAgKiBTdG9yZSB0aGUgcmVjZWl2ZWQgc2hhcmUgYW5kIHJlc29sdmVzIHRoZSBjb3JyZXNwb25kaW5nXG4gICAqIGRlZmVycmVkIGlmIG5lZWRlZC5cbiAgICogQG1ldGhvZFxuICAgKiBAbWVtYmVyb2YgaGFuZGxlcnNcbiAgICogQHBhcmFtIHtvYmplY3R9IGpzb25fbXNnIC0gdGhlIHBhcnNlZCBqc29uIG1lc3NhZ2UgYXMgcmVjZWl2ZWQuXG4gICAqL1xuICBqaWZmQ2xpZW50LmhhbmRsZXJzLnJlY2VpdmVfc2hhcmUgPSBmdW5jdGlvbiAoanNvbl9tc2cpIHtcbiAgICAvLyBEZWNyeXB0IHNoYXJlXG4gICAgbGV0IGRlY3J5cHRlZCA9IGppZmZDbGllbnQuaG9va3MuZGVjcnlwdFNpZ24oamlmZkNsaWVudCwganNvbl9tc2dbJ3NoYXJlJ10sIGppZmZDbGllbnQuc2VjcmV0X2tleSwgamlmZkNsaWVudC5rZXltYXBbanNvbl9tc2dbJ3BhcnR5X2lkJ11dKTtcbiAgICBcbiAgICB2YXIgcmVhZHkgPSBmdW5jdGlvbiAoZGVjcnlwdGVkKSB7XG4gICAgICBqc29uX21zZ1snc2hhcmUnXSA9IGRlY3J5cHRlZDtcbiAgICAgIGpzb25fbXNnID0gamlmZkNsaWVudC5ob29rcy5leGVjdXRlX2FycmF5X2hvb2tzKCdhZnRlck9wZXJhdGlvbicsIFtqaWZmQ2xpZW50LCAnc2hhcmUnLCBqc29uX21zZ10sIDIpO1xuXG4gICAgICB2YXIgc2VuZGVyX2lkID0ganNvbl9tc2dbJ3BhcnR5X2lkJ107XG4gICAgICB2YXIgb3BfaWQgPSBqc29uX21zZ1snb3BfaWQnXTtcbiAgICAgIHZhciBzaGFyZSA9IGpzb25fbXNnWydzaGFyZSddO1xuXG4gICAgICAvLyBDYWxsIGhvb2tcbiAgICAgIHNoYXJlID0gamlmZkNsaWVudC5ob29rcy5leGVjdXRlX2FycmF5X2hvb2tzKCdyZWNlaXZlU2hhcmUnLCBbamlmZkNsaWVudCwgc2VuZGVyX2lkLCBzaGFyZV0sIDIpO1xuXG4gICAgICAvLyBjaGVjayBpZiBhIGRlZmVycmVkIGlzIHNldCB1cCAobWF5YmUgdGhlIHNoYXJlIHdhcyByZWNlaXZlZCBlYXJseSlcbiAgICAgIGlmIChqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF0gPT0gbnVsbCkge1xuICAgICAgICBqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF0gPSB7fTtcbiAgICAgIH1cbiAgICAgIGlmIChqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF1bc2VuZGVyX2lkXSA9PSBudWxsKSB7XG4gICAgICAgIC8vIFNoYXJlIGlzIHJlY2VpdmVkIGJlZm9yZSBkZWZlcnJlZCB3YXMgc2V0dXAsIHN0b3JlIGl0LlxuICAgICAgICBqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF1bc2VuZGVyX2lkXSA9IG5ldyBqaWZmQ2xpZW50LmhlbHBlcnMuRGVmZXJyZWQoKTtcbiAgICAgIH1cblxuICAgICAgLy8gRGVmZXJyZWQgaXMgYWxyZWFkeSBzZXR1cCwgcmVzb2x2ZSBpdC5cbiAgICAgIGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXVtzZW5kZXJfaWRdLnJlc29sdmUoc2hhcmUpO1xuICAgIH1cblxuICAgIGlmIChkZWNyeXB0ZWQudGhlbikge1xuICAgICAgZGVjcnlwdGVkLnRoZW4ocmVhZHkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZWFkeShkZWNyeXB0ZWQpO1xuICAgIH1cbiAgfTtcblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlZmVycmVkIGNvcnJlc3BvbmRpbmcgdG8gb3BlcmF0aW9uX2lkIGFuZCBzZW5kZXJfaWQuXG4gICAqIEBtZXRob2RcbiAgICogQG1lbWJlcm9mIGhhbmRsZXJzXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBqc29uX21zZyAtIHRoZSBqc29uIG1lc3NhZ2UgYXMgcmVjZWl2ZWQgd2l0aCB0aGUgb3BlbiBldmVudC5cbiAgICovXG4gIGppZmZDbGllbnQuaGFuZGxlcnMucmVjZWl2ZV9vcGVuID0gZnVuY3Rpb24gKGpzb25fbXNnKSB7XG4gICAgLy8gRGVjcnlwdCBzaGFyZVxuICAgIGlmIChqc29uX21zZ1sncGFydHlfaWQnXSAhPT0gamlmZkNsaWVudC5pZCkge1xuICAgICAgdmFyIGRlY3J5cHRlZCA9IGppZmZDbGllbnQuaG9va3MuZGVjcnlwdFNpZ24oamlmZkNsaWVudCwganNvbl9tc2dbJ3NoYXJlJ10sIGppZmZDbGllbnQuc2VjcmV0X2tleSwgamlmZkNsaWVudC5rZXltYXBbanNvbl9tc2dbJ3BhcnR5X2lkJ11dKTtcbiAgICB9XG5cbiAgICB2YXIgcmVhZHkgPSBmdW5jdGlvbiAoZGVjcnlwdGVkKSB7XG4gICAgICBpZiAoanNvbl9tc2dbJ3BhcnR5X2lkJ10gIT09IGppZmZDbGllbnQuaWQpIHtcbiAgICAgICAganNvbl9tc2dbJ3NoYXJlJ10gPSBkZWNyeXB0ZWQ7XG4gICAgICAgIGpzb25fbXNnID0gamlmZkNsaWVudC5ob29rcy5leGVjdXRlX2FycmF5X2hvb2tzKCdhZnRlck9wZXJhdGlvbicsIFtqaWZmQ2xpZW50LCAnb3BlbicsIGpzb25fbXNnXSwgMik7XG4gICAgICB9XG5cbiAgICAgIHZhciBzZW5kZXJfaWQgPSBqc29uX21zZ1sncGFydHlfaWQnXTtcbiAgICAgIHZhciBvcF9pZCA9IGpzb25fbXNnWydvcF9pZCddO1xuICAgICAgdmFyIHNoYXJlID0ganNvbl9tc2dbJ3NoYXJlJ107XG4gICAgICB2YXIgWnAgPSBqc29uX21zZ1snWnAnXTtcblxuICAgICAgLy8gY2FsbCBob29rXG4gICAgICBzaGFyZSA9IGppZmZDbGllbnQuaG9va3MuZXhlY3V0ZV9hcnJheV9ob29rcygncmVjZWl2ZU9wZW4nLCBbamlmZkNsaWVudCwgc2VuZGVyX2lkLCBzaGFyZSwgWnBdLCAyKTtcblxuICAgICAgLy8gRW5zdXJlIGRlZmVycmVkIGlzIHNldHVwXG4gICAgICBpZiAoamlmZkNsaWVudC5kZWZlcnJlZHNbb3BfaWRdID09IG51bGwpIHtcbiAgICAgICAgamlmZkNsaWVudC5kZWZlcnJlZHNbb3BfaWRdID0ge307XG4gICAgICB9XG4gICAgICBpZiAoamlmZkNsaWVudC5kZWZlcnJlZHNbb3BfaWRdLnNoYXJlcyA9PSBudWxsKSB7XG4gICAgICAgIGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXS5zaGFyZXMgPSBbXTtcbiAgICAgIH1cblxuICAgICAgLy8gQWNjdW11bGF0ZSByZWNlaXZlZCBzaGFyZXNcbiAgICAgIGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXS5zaGFyZXMucHVzaCh7dmFsdWU6IHNoYXJlLCBzZW5kZXJfaWQ6IHNlbmRlcl9pZCwgWnA6IFpwfSk7XG5cbiAgICAgIC8vIFJlc29sdmUgd2hlbiByZWFkeVxuICAgICAgaWYgKGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXS5zaGFyZXMubGVuZ3RoID09PSBqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF0udGhyZXNob2xkKSB7XG4gICAgICAgIGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXS5kZWZlcnJlZC5yZXNvbHZlKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIENsZWFuIHVwIGlmIGRvbmVcbiAgICAgIGlmIChqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF0gIT0gbnVsbCAmJiBqaWZmQ2xpZW50LmRlZmVycmVkc1tvcF9pZF0uZGVmZXJyZWQgPT09ICdDTEVBTicgJiYgamlmZkNsaWVudC5kZWZlcnJlZHNbb3BfaWRdLnNoYXJlcy5sZW5ndGggPT09IGppZmZDbGllbnQuZGVmZXJyZWRzW29wX2lkXS50b3RhbCkge1xuICAgICAgICBkZWxldGUgamlmZkNsaWVudC5kZWZlcnJlZHNbb3BfaWRdO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChkZWNyeXB0ZWQgIT0gbnVsbCAmJiBkZWNyeXB0ZWQudGhlbikge1xuICAgICAgZGVjcnlwdGVkLnRoZW4ocmVhZHkpO1xuICAgIH0gZWxzZSBpZiAoZGVjcnlwdGVkICE9IG51bGwpIHtcbiAgICAgIHJlYWR5KGRlY3J5cHRlZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlYWR5KGpzb25fbXNnWydzaGFyZSddKTtcbiAgICB9XG4gIH1cbn07IiwiLyoqIERvdWJseSBsaW5rZWQgbGlzdCB3aXRoIGFkZCBhbmQgcmVtb3ZlIGZ1bmN0aW9ucyBhbmQgcG9pbnRlcnMgdG8gaGVhZCBhbmQgdGFpbCoqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG4gIC8vIGF0dHJpYnV0ZXM6IGxpc3QuaGVhZCBhbmQgbGlzdC50YWlsXG4gIC8vIGZ1bmN0aW9uczogbGlzdC5hZGQob2JqZWN0KSAocmV0dXJucyBwb2ludGVyKSwgbGlzdC5yZW1vdmUocG9pbnRlcilcbiAgLy8gbGlzdC5oZWFkL2xpc3QudGFpbC9hbnkgZWxlbWVudCBjb250YWluczpcbiAgLy8gICAgbmV4dDogcG9pbnRlciB0byBuZXh0LFxuICAvLyAgICBwcmV2aW91czogcG9pbnRlciB0byBwcmV2aW91cyxcbiAgLy8gICAgb2JqZWN0OiBzdG9yZWQgb2JqZWN0LlxuICB2YXIgbGlzdCA9IHtoZWFkOiBudWxsLCB0YWlsOiBudWxsfTtcbiAgLy8gVE9ETyByZW5hbWUgdGhpcyB0byBwdXNoVGFpbCB8fCBwdXNoXG4gIGxpc3QuYWRkID0gZnVuY3Rpb24gKG9iaikge1xuICAgIHZhciBub2RlID0geyBvYmplY3Q6IG9iaiwgbmV4dDogbnVsbCwgcHJldmlvdXM6IG51bGwgfTtcbiAgICBpZiAobGlzdC5oZWFkID09IG51bGwpIHtcbiAgICAgIGxpc3QuaGVhZCA9IG5vZGU7XG4gICAgICBsaXN0LnRhaWwgPSBub2RlO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaXN0LnRhaWwubmV4dCA9IG5vZGU7XG4gICAgICBub2RlLnByZXZpb3VzID0gbGlzdC50YWlsO1xuICAgICAgbGlzdC50YWlsID0gbm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIG5vZGU7XG4gIH07XG5cbiAgbGlzdC5wdXNoSGVhZCA9IGZ1bmN0aW9uIChvYmopIHtcbiAgICBsaXN0LmhlYWQgPSB7b2JqZWN0OiBvYmosIG5leHQgOiBsaXN0LmhlYWQsIHByZXZpb3VzIDogbnVsbH07XG4gICAgaWYgKGxpc3QuaGVhZC5uZXh0ICE9IG51bGwpIHtcbiAgICAgIGxpc3QuaGVhZC5uZXh0LnByZXZpb3VzID0gbGlzdC5oZWFkO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaXN0LnRhaWwgPSBsaXN0LmhlYWQ7XG4gICAgfVxuICB9O1xuXG4gIGxpc3QucG9wSGVhZCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcmVzdWx0ID0gbGlzdC5oZWFkO1xuICAgIGlmIChsaXN0LmhlYWQgIT0gbnVsbCkge1xuICAgICAgbGlzdC5oZWFkID0gbGlzdC5oZWFkLm5leHQ7XG4gICAgICBpZiAobGlzdC5oZWFkID09IG51bGwpIHtcbiAgICAgICAgbGlzdC50YWlsID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxpc3QuaGVhZC5wcmV2aW91cyAgPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIG1lcmdlcyB0d28gbGlua2VkIGxpc3RzIGFuZCByZXR1cm4gYSBwb2ludGVyIHRvIHRoZSBoZWFkIG9mIHRoZSBtZXJnZWQgbGlzdFxuICAvLyB0aGUgaGVhZCB3aWxsIGJlIHRoZSBoZWFkIG9mIGxpc3QgYW5kIHRoZSB0YWlsIHRoZSB0YWlsIG9mIGwyXG4gIGxpc3QuZXh0ZW5kID0gZnVuY3Rpb24gKGwyKSB7XG4gICAgaWYgKGxpc3QuaGVhZCA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gbDI7XG4gICAgfVxuICAgIGlmIChsMi5oZWFkID09IG51bGwpIHtcbiAgICAgIHJldHVybiBsaXN0O1xuICAgIH1cbiAgICBsaXN0LnRhaWwubmV4dCA9IGwyLmhlYWQ7XG4gICAgbDIuaGVhZC5wcmV2aW91cyA9IGxpc3QudGFpbDtcbiAgICBsaXN0LnRhaWwgPSBsMi50YWlsO1xuXG4gICAgcmV0dXJuIGxpc3Q7XG4gIH07XG5cbiAgbGlzdC5yZW1vdmUgPSBmdW5jdGlvbiAocHRyKSB7XG4gICAgdmFyIHByZXYgPSBwdHIucHJldmlvdXM7XG4gICAgdmFyIG5leHQgPSBwdHIubmV4dDtcblxuICAgIGlmIChwcmV2ID09IG51bGwgJiYgbGlzdC5oZWFkICE9PSBwdHIpIHtcbiAgICAgIHJldHVybjtcbiAgICB9IGVsc2UgaWYgKG5leHQgPT0gbnVsbCAmJiBsaXN0LnRhaWwgIT09IHB0cikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChwcmV2ID09IG51bGwpIHsgLy8gcHRyIGlzIGhlYWQgKG9yIGJvdGggaGVhZCBhbmQgdGFpbClcbiAgICAgIGxpc3QuaGVhZCA9IG5leHQ7XG4gICAgICBpZiAobGlzdC5oZWFkICE9IG51bGwpIHtcbiAgICAgICAgbGlzdC5oZWFkLnByZXZpb3VzID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxpc3QudGFpbCA9IG51bGw7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChuZXh0ID09IG51bGwpIHsgLy8gcHRyIGlzIHRhaWwgKGFuZCBub3QgaGVhZClcbiAgICAgIGxpc3QudGFpbCA9IHByZXY7XG4gICAgICBwcmV2Lm5leHQgPSBudWxsO1xuICAgIH0gZWxzZSB7IC8vIHB0ciBpcyBpbnNpZGVcbiAgICAgIHByZXYubmV4dCA9IG5leHQ7XG4gICAgICBuZXh0LnByZXZpb3VzID0gcHJldjtcbiAgICB9XG4gIH07XG4gIGxpc3Quc2xpY2UgPSBmdW5jdGlvbiAocHRyKSB7IC8vIHJlbW92ZSBhbGwgZWxlbWVudHMgZnJvbSBoZWFkIHRvIHB0ciAoaW5jbHVkaW5nIHB0cikuXG4gICAgaWYgKHB0ciA9PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLyogQ09OU0VSVkFUSVZFOiBtYWtlIHN1cmUgcHRyIGlzIHBhcnQgb2YgdGhlIGxpc3QgdGhlbiByZW1vdmUgKi9cbiAgICB2YXIgY3VycmVudCA9IGxpc3QuaGVhZDtcbiAgICB3aGlsZSAoY3VycmVudCAhPSBudWxsKSB7XG4gICAgICBpZiAoY3VycmVudCA9PT0gcHRyKSB7XG4gICAgICAgIGxpc3QuaGVhZCA9IHB0ci5uZXh0O1xuICAgICAgICBpZiAobGlzdC5oZWFkID09IG51bGwpIHtcbiAgICAgICAgICBsaXN0LnRhaWwgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY3VycmVudCA9IGN1cnJlbnQubmV4dDtcbiAgICB9XG5cbiAgICAvKiBNT1JFIEFHR1JFU1NJVkUgVkVSU0lPTjogd2lsbCBiZSBpbmNvcnJlY3QgaWYgcHRyIGlzIG5vdCBpbiB0aGUgbGlzdCAqL1xuICAgIC8qXG4gICAgbGlzdC5oZWFkID0gcHRyLm5leHQ7XG4gICAgaWYgKGxpc3QuaGVhZCA9PSBudWxsKSB7XG4gICAgICBsaXN0LnRhaWwgPSBudWxsO1xuICAgIH1cbiAgICAqL1xuICB9O1xuICAvKlxuICBsaXN0Ll9kZWJ1Z19sZW5ndGggPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGwgPSAwO1xuICAgIHZhciBjdXJyZW50ID0gbGlzdC5oZWFkO1xuICAgIHdoaWxlIChjdXJyZW50ICE9IG51bGwpIHtcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50Lm5leHQ7XG4gICAgICBsKys7XG4gICAgfVxuICAgIHJldHVybiBsO1xuICB9O1xuICAqL1xuICByZXR1cm4gbGlzdDtcbn07XG4iLCIvKipcbiAqIFRoaXMgZGVmaW5lcyBhIGxpYnJhcnkgZXh0ZW5zaW9uIGZvciB1c2luZyB3ZWJzb2NrZXRzIHJhdGhlciB0aGFuIHNvY2tldC5pbyBmb3IgY29tbXVuaWNhdGlvbi4gVGhpc1xuICogZXh0ZW5zaW9uIHByaW1hcmlseSBlZGl0cy9vdmVyd3JpdGVzIGV4aXN0aW5nIHNvY2tldCBmdW5jdGlvbnMgdG8gdXNlIGFuZCBiZSBjb21wYXRpYmxlIHdpdGggdGhlXG4gKiB3cyBsaWJyYXJ5LlxuICogQG5hbWVzcGFjZSBqaWZmY2xpZW50X3dlYnNvY2tldHNcbiAqIEB2ZXJzaW9uIDEuMFxuICpcbiAqIFJFUVVJUkVNRU5UUzpcbiAqIFlvdSBtdXN0IGFwcGx5IHRoaXMgZXh0ZW5zaW9uIHRvIHlvdXIgY2xpZW50IGFuZCB0aGUgc2VydmVyIHlvdSdyZSBjb21tdW5pY2F0aW5nIHdpdGggbXVzdCBhcHBseSBqaWZmc2VydmVyX3dlYnNvY2tldHMuXG4gKiBXaGVuIHVzaW5nIHRoaXMgZXh0ZW5zaW9uIGluIGJyb3dzZXIsIFwiL2Rpc3QvamlmZi1jbGllbnQtd2Vic29ja2V0cy5qc1wiIG11c3QgYmUgbG9hZGVkIGluIGNsaWVudC5odG1sIGluc3RlYWQgb2YgdGhpcyBmaWxlLlxuICovXG5cblxuXG4oZnVuY3Rpb24gKGV4cG9ydHMsIG5vZGUpIHtcbiAgLyoqXG4gICAqIFRoZSBuYW1lIG9mIHRoaXMgZXh0ZW5zaW9uOiAnd2Vic29ja2V0J1xuICAgKiBAdHlwZSB7c3RyaW5nfVxuICAgKiBAbWVtYmVyT2YgamlmZmNsaWVudF93ZWJzb2NrZXRzXG4gICAqL1xuXG4gIHZhciB3cztcbiAgdmFyIGxpbmtlZExpc3Q7XG4gIHZhciBoYW5kbGVycztcblxuICBsaW5rZWRMaXN0ID0gcmVxdWlyZSgnLi4vY29tbW9uL2xpbmtlZGxpc3QuanMnKTtcbiAgaGFuZGxlcnMgPSByZXF1aXJlKCcuLi9jbGllbnQvaGFuZGxlcnMuanMnKTtcbiAgaWYgKCFwcm9jZXNzLmJyb3dzZXIpIHtcbiAgICB3cyA9IHJlcXVpcmUoJ3dzJyk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKHR5cGVvZiBXZWJTb2NrZXQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB3cyA9IFdlYlNvY2tldFxuICAgIH0gZWxzZSBpZiAodHlwZW9mIE1veldlYlNvY2tldCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHdzID0gTW96V2ViU29ja2V0XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZ2xvYmFsICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgd3MgPSBnbG9iYWwuV2ViU29ja2V0IHx8IGdsb2JhbC5Nb3pXZWJTb2NrZXRcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB3cyA9IHdpbmRvdy5XZWJTb2NrZXQgfHwgd2luZG93Lk1veldlYlNvY2tldFxuICAgIH0gZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB3cyA9IHNlbGYuV2ViU29ja2V0IHx8IHNlbGYuTW96V2ViU29ja2V0XG4gICAgfVxuICB9XG5cblxuICAvLyBUYWtlIHRoZSBqaWZmLWNsaWVudCBiYXNlIGluc3RhbmNlIGFuZCBvcHRpb25zIGZvciB0aGlzIGV4dGVuc2lvbiwgYW5kIHVzZSB0aGVtXG4gIC8vIHRvIGNvbnN0cnVjdCBhbiBpbnN0YW5jZSBmb3IgdGhpcyBleHRlbnNpb24uXG4gIGZ1bmN0aW9uIG1ha2VfamlmZihiYXNlX2luc3RhbmNlLCBvcHRpb25zKSB7XG4gICAgdmFyIGppZmYgPSBiYXNlX2luc3RhbmNlO1xuXG4gICAgLy8gUGFyc2Ugb3B0aW9uc1xuICAgIGlmIChvcHRpb25zID09IG51bGwpIHtcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9XG5cbiAgICAvKiBGdW5jdGlvbnMgdGhhdCBvdmVyd3JpdGUgY2xpZW50L3NvY2tldC9ldmVudHMuanMgZnVuY3Rpb25hbGl0eSAqL1xuXG4gICAgLyoqXG4gICAgICogaW5pdFNvY2tldCdzICcub24nIGZ1bmN0aW9ucyBuZWVkZWQgdG8gYmUgcmVwbGFjZWQgc2luY2Ugd3MgZG9lc1xuICAgICAqIG5vdCBoYXZlIGFzIG1hbnkgcHJvdG9jb2xzLiBJbnN0ZWFkIHRoZXNlIGZ1bmN0aW9ucyBhcmUgcm91dGVkIHRvXG4gICAgICogd2hlbiBhIG1lc3NhZ2UgaXMgcmVjZWl2ZWQgYW5kIGEgcHJvdG9jb2wgaXMgbWFudWFsbHkgcGFyc2VkLlxuICAgICAqL1xuICAgIGppZmYuaW5pdFNvY2tldCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBqaWZmQ2xpZW50ID0gdGhpcztcblxuICAgICAgLyogd3MgdXNlcyB0aGUgJ29wZW4nIHByb3RvY29sIG9uIGNvbm5lY3Rpb24uIFNob3VsZCBub3QgY29uZmxpY3Qgd2l0aCB0aGVcbiAgICAgICAgICAgSklGRiBvcGVuIHByb3RvY2wgYXMgdGhhdCB3aWxsIGJlIHNlbnQgYXMgYSBtZXNzYWdlIGFuZCB3c1xuICAgICAgICAgICB3aWxsIHNlZSBpdCBhcyBhICdtZXNzYWdlJyBwcm90b2NvbC4gKi9cbiAgICAgIHRoaXMuc29ja2V0Lm9ub3BlbiA9IGppZmZDbGllbnQuaGFuZGxlcnMuY29ubmVjdGVkO1xuXG4gICAgICAvLyBQdWJsaWMga2V5cyB3ZXJlIHVwZGF0ZWQgb24gdGhlIHNlcnZlciwgYW5kIGl0IHNlbnQgdXMgdGhlIHVwZGF0ZXNcbiAgICAgIGZ1bmN0aW9uIHB1YmxpY0tleXNDaGFuZ2VkKG1zZywgY2FsbGJhY2spIHtcblxuICAgICAgICBtc2cgPSBKU09OLnBhcnNlKG1zZyk7XG4gICAgICAgIG1zZyA9IGppZmZDbGllbnQuaG9va3MuZXhlY3V0ZV9hcnJheV9ob29rcygnYWZ0ZXJPcGVyYXRpb24nLCBbamlmZkNsaWVudCwgJ3B1YmxpY19rZXlzJywgbXNnXSwgMik7XG5cbiAgICAgICAgamlmZkNsaWVudC5oYW5kbGVycy5zdG9yZV9wdWJsaWNfa2V5cyhtc2cucHVibGljX2tleXMpO1xuICAgICAgfVxuXG4gICAgICAvLyBTZXR1cCByZWNlaXZpbmcgbWF0Y2hpbmcgc2hhcmVzXG4gICAgICBmdW5jdGlvbiBzaGFyZShtc2csIGNhbGxiYWNrKSB7XG5cbiAgICAgICAgLy8gcGFyc2UgbWVzc2FnZVxuICAgICAgICB2YXIganNvbl9tc2cgPSBKU09OLnBhcnNlKG1zZyk7XG4gICAgICAgIHZhciBzZW5kZXJfaWQgPSBqc29uX21zZ1sncGFydHlfaWQnXTtcblxuICAgICAgICBpZiAoamlmZkNsaWVudC5rZXltYXBbc2VuZGVyX2lkXSAhPSBudWxsKSB7XG4gICAgICAgICAgamlmZkNsaWVudC5oYW5kbGVycy5yZWNlaXZlX3NoYXJlKGpzb25fbXNnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAoamlmZkNsaWVudC5tZXNzYWdlc1dhaXRpbmdLZXlzW3NlbmRlcl9pZF0gPT0gbnVsbCkge1xuICAgICAgICAgICAgamlmZkNsaWVudC5tZXNzYWdlc1dhaXRpbmdLZXlzW3NlbmRlcl9pZF0gPSBbXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgamlmZkNsaWVudC5tZXNzYWdlc1dhaXRpbmdLZXlzW3NlbmRlcl9pZF0ucHVzaCh7IGxhYmVsOiAnc2hhcmUnLCBtc2c6IGpzb25fbXNnIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIG1wY09wZW4obXNnLCBjYWxsYmFjaykge1xuICAgICAgICAvLyBwYXJzZSBtZXNzYWdlXG4gICAgICAgIHZhciBqc29uX21zZyA9IEpTT04ucGFyc2UobXNnKTtcbiAgICAgICAgdmFyIHNlbmRlcl9pZCA9IGpzb25fbXNnWydwYXJ0eV9pZCddO1xuXG4gICAgICAgIGlmIChqaWZmQ2xpZW50LmtleW1hcFtzZW5kZXJfaWRdICE9IG51bGwpIHtcbiAgICAgICAgICBqaWZmQ2xpZW50LmhhbmRsZXJzLnJlY2VpdmVfb3Blbihqc29uX21zZyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKGppZmZDbGllbnQubWVzc2FnZXNXYWl0aW5nS2V5c1tzZW5kZXJfaWRdID09IG51bGwpIHtcbiAgICAgICAgICAgIGppZmZDbGllbnQubWVzc2FnZXNXYWl0aW5nS2V5c1tzZW5kZXJfaWRdID0gW107XG4gICAgICAgICAgfVxuICAgICAgICAgIGppZmZDbGllbnQubWVzc2FnZXNXYWl0aW5nS2V5c1tzZW5kZXJfaWRdLnB1c2goeyBsYWJlbDogJ29wZW4nLCBtc2c6IGpzb25fbXNnIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIGhhbmRsZSBjdXN0b20gbWVzc2FnZXNcbiAgICAgIGZ1bmN0aW9uIHNvY2tldEN1c3RvbShtc2csIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBqc29uX21zZyA9IEpTT04ucGFyc2UobXNnKTtcbiAgICAgICAgdmFyIHNlbmRlcl9pZCA9IGpzb25fbXNnWydwYXJ0eV9pZCddO1xuICAgICAgICB2YXIgZW5jcnlwdGVkID0ganNvbl9tc2dbJ2VuY3J5cHRlZCddO1xuXG4gICAgICAgIGlmIChqaWZmQ2xpZW50LmtleW1hcFtzZW5kZXJfaWRdICE9IG51bGwgfHwgZW5jcnlwdGVkICE9PSB0cnVlKSB7XG4gICAgICAgICAgamlmZkNsaWVudC5oYW5kbGVycy5yZWNlaXZlX2N1c3RvbShqc29uX21zZyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8ga2V5IG11c3Qgbm90IGV4aXN0IHlldCBmb3Igc2VuZGVyX2lkLCBhbmQgZW5jcnlwdGVkIG11c3QgYmUgdHJ1ZVxuICAgICAgICAgIGlmIChqaWZmQ2xpZW50Lm1lc3NhZ2VzV2FpdGluZ0tleXNbc2VuZGVyX2lkXSA9PSBudWxsKSB7XG4gICAgICAgICAgICBqaWZmQ2xpZW50Lm1lc3NhZ2VzV2FpdGluZ0tleXNbc2VuZGVyX2lkXSA9IFtdO1xuICAgICAgICAgIH1cbiAgICAgICAgICBqaWZmQ2xpZW50Lm1lc3NhZ2VzV2FpdGluZ0tleXNbc2VuZGVyX2lkXS5wdXNoKHsgbGFiZWw6ICdjdXN0b20nLCBtc2c6IGpzb25fbXNnIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIGNyeXB0b1Byb3ZpZGVyKG1zZywgY2FsbGJhY2spIHtcbiAgICAgICAgamlmZkNsaWVudC5oYW5kbGVycy5yZWNlaXZlX2NyeXB0b19wcm92aWRlcihKU09OLnBhcnNlKG1zZykpO1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBvbkVycm9yKG1zZykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIG1zZyA9IEpTT04ucGFyc2UobXNnKTtcbiAgICAgICAgICBqaWZmQ2xpZW50LmhhbmRsZXJzLmVycm9yKG1zZ1snbGFiZWwnXSwgbXNnWydlcnJvciddKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBqaWZmQ2xpZW50LmhhbmRsZXJzLmVycm9yKCdzb2NrZXQuaW8nLCBtc2cpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIHNvY2tldENsb3NlKHJlYXNvbikge1xuICAgICAgICBpZiAocmVhc29uICE9PSAnaW8gY2xpZW50IGRpc2Nvbm5lY3QnKSB7XG4gICAgICAgICAgLy8gY2hlY2sgdGhhdCB0aGUgcmVhc29uIGlzIGFuIGVycm9yIGFuZCBub3QgYSB1c2VyIGluaXRpYXRlZCBkaXNjb25uZWN0XG4gICAgICAgICAgY29uc29sZS5sb2coJ0Rpc2Nvbm5lY3RlZCEnLCBqaWZmQ2xpZW50LmlkLCByZWFzb24pO1xuICAgICAgICB9XG5cbiAgICAgICAgamlmZkNsaWVudC5ob29rcy5leGVjdXRlX2FycmF5X2hvb2tzKCdhZnRlck9wZXJhdGlvbicsIFtqaWZmQ2xpZW50LCAnZGlzY29ubmVjdCcsIHJlYXNvbl0sIC0xKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5zb2NrZXQub25jbG9zZSA9IGZ1bmN0aW9uIChyZWFzb24pIHtcbiAgICAgICAgc29ja2V0Q2xvc2UocmVhc29uLmNvZGUpO1xuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIEluIGV2ZXJ5IG1lc3NhZ2Ugc2VudCBvdmVyIHdzLCB3ZSB3aWxsIHNlbmQgYWxvbmcgd2l0aCBpdCBhIHNvY2tldFByb3RvY29sIHN0cmluZ1xuICAgICAgICogdGhhdCB3aWxsIGJlIHBhcnNlZCBieSB0aGUgcmVjZWl2ZXIgdG8gcm91dGUgdGhlIHJlcXVlc3QgdG8gdGhlIGNvcnJlY3QgZnVuY3Rpb24uIFRoZVxuICAgICAgICogcHJldmlvdXMgaW5mb3JtYXRpb24gc2VudCBieSBzb2NrZXQuaW8gd2lsbCBiZSB1bnRvdWNoZWQsIGJ1dCBub3cgc2VudCBpbnNpZGUgb2YgbXNnLmRhdGEuXG4gICAgICAgKi9cbiAgICAgIHRoaXMuc29ja2V0Lm9ubWVzc2FnZSA9IGZ1bmN0aW9uIChtc2csIGNhbGxiYWNrKSB7XG4gICAgICAgIG1zZyA9IEpTT04ucGFyc2UobXNnLmRhdGEpO1xuXG4gICAgICAgIHN3aXRjaCAobXNnLnNvY2tldFByb3RvY29sKSB7XG4gICAgICAgICAgY2FzZSAnaW5pdGlhbGl6YXRpb24nOlxuICAgICAgICAgICAgamlmZkNsaWVudC5oYW5kbGVycy5pbml0aWFsaXplZChtc2cuZGF0YSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdwdWJsaWNfa2V5cyc6XG4gICAgICAgICAgICBwdWJsaWNLZXlzQ2hhbmdlZChtc2cuZGF0YSwgY2FsbGJhY2spO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnc2hhcmUnOlxuICAgICAgICAgICAgc2hhcmUobXNnLmRhdGEsIGNhbGxiYWNrKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ29wZW4nOlxuICAgICAgICAgICAgbXBjT3Blbihtc2cuZGF0YSwgY2FsbGJhY2spO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnY3VzdG9tJzpcbiAgICAgICAgICAgIHNvY2tldEN1c3RvbShtc2cuZGF0YSwgY2FsbGJhY2spO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnY3J5cHRvX3Byb3ZpZGVyJzpcbiAgICAgICAgICAgIGNyeXB0b1Byb3ZpZGVyKG1zZy5kYXRhLCBjYWxsYmFjayk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdjbG9zZSc6XG4gICAgICAgICAgICBzb2NrZXRDbG9zZShtc2cuZGF0YSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdkaXNjb25uZWN0JzpcbiAgICAgICAgICAgIHNvY2tldENsb3NlKG1zZy5kYXRhKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ2Vycm9yJzpcbiAgICAgICAgICAgIG9uRXJyb3IobXNnLmRhdGEpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVa25vd24gcHJvdG9jb2wsICcgKyBtc2cuc29ja2V0UHJvdG9jb2wgKyAnLCByZWNlaXZlZCcpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICB9O1xuXG4gICAgLyogT3ZlcndyaXRlIHRoZSBzb2NrZXRDb25uZWN0IGZ1bmN0aW9uIGZyb20gamlmZi1jbGllbnQuanMgKi9cblxuICAgIGppZmYuc29ja2V0Q29ubmVjdCA9IGZ1bmN0aW9uIChKSUZGQ2xpZW50SW5zdGFuY2UpIHtcblxuICAgICAgaWYgKG9wdGlvbnMuX19pbnRlcm5hbF9zb2NrZXQgPT0gbnVsbCkge1xuICAgICAgICAvKipcbiAgICAgICAgICogU29ja2V0IHdyYXBwZXIgYmV0d2VlbiB0aGlzIGluc3RhbmNlIGFuZCB0aGUgc2VydmVyLCBiYXNlZCBvbiBzb2NrZXRzLmlvXG4gICAgICAgICAqIEB0eXBlIHshR3VhcmRlZFNvY2tldH1cbiAgICAgICAgICovXG4gICAgICAgIEpJRkZDbGllbnRJbnN0YW5jZS5zb2NrZXQgPSBndWFyZGVkU29ja2V0KEpJRkZDbGllbnRJbnN0YW5jZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBKSUZGQ2xpZW50SW5zdGFuY2Uuc29ja2V0ID0gaW50ZXJuYWxTb2NrZXQoSklGRkNsaWVudEluc3RhbmNlLCBvcHRpb25zLl9faW50ZXJuYWxfc29ja2V0KTtcbiAgICAgIH1cblxuICAgICAgLy8gc2V0IHVwIHNvY2tldCBldmVudCBoYW5kbGVyc1xuICAgICAgaGFuZGxlcnMoSklGRkNsaWVudEluc3RhbmNlKTtcblxuICAgICAgLy8gT3ZlcndyaXRlIGhhbmRsZXJzLmNvbm5lY3RlZCB3aXRoIG91ciBuZXcgd3MgY29ubmVjdGlvbiBoYW5kbGVyXG4gICAgICBKSUZGQ2xpZW50SW5zdGFuY2UuaGFuZGxlcnMuY29ubmVjdGVkID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBKSUZGQ2xpZW50SW5zdGFuY2UuaW5pdGlhbGl6YXRpb25fY291bnRlcisrO1xuXG4gICAgICAgIGlmIChKSUZGQ2xpZW50SW5zdGFuY2Uuc2VjcmV0X2tleSA9PSBudWxsICYmIEpJRkZDbGllbnRJbnN0YW5jZS5wdWJsaWNfa2V5ID09IG51bGwpIHtcbiAgICAgICAgICB2YXIga2V5ID0gSklGRkNsaWVudEluc3RhbmNlLmhvb2tzLmdlbmVyYXRlS2V5UGFpcihKSUZGQ2xpZW50SW5zdGFuY2UpO1xuICAgICAgICAgIEpJRkZDbGllbnRJbnN0YW5jZS5zZWNyZXRfa2V5ID0ga2V5LnNlY3JldF9rZXk7XG4gICAgICAgICAgSklGRkNsaWVudEluc3RhbmNlLnB1YmxpY19rZXkgPSBrZXkucHVibGljX2tleTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEluaXRpYWxpemF0aW9uIG1lc3NhZ2VcbiAgICAgICAgdmFyIG1zZyA9IEpJRkZDbGllbnRJbnN0YW5jZS5oYW5kbGVycy5idWlsZF9pbml0aWFsaXphdGlvbl9tZXNzYWdlKCk7XG5cbiAgICAgICAgLy8gRG91YmxlIHdyYXAgdGhlIG1zZ1xuICAgICAgICBtc2cgPSBKU09OLnN0cmluZ2lmeShtc2cpO1xuXG4gICAgICAgIC8vIEVtaXQgaW5pdGlhbGl6YXRpb24gbWVzc2FnZSB0byBzZXJ2ZXJcbiAgICAgICAgSklGRkNsaWVudEluc3RhbmNlLnNvY2tldC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgc29ja2V0UHJvdG9jb2w6ICdpbml0aWFsaXphdGlvbicsIGRhdGE6IG1zZyB9KSk7XG4gICAgICB9O1xuXG5cbiAgICAgIEpJRkZDbGllbnRJbnN0YW5jZS5pbml0U29ja2V0KCk7XG4gICAgfVxuXG4gICAgLyogRnVuY3Rpb25zIHRoYXQgb3ZlcndyaXRlIGNsaWVudC9zb2NrZXQvbWFpbGJveC5qcyBmdW5jdGlvbmFsaXR5ICovXG5cbiAgICBmdW5jdGlvbiBndWFyZGVkU29ja2V0KGppZmZDbGllbnQpIHtcbiAgICAgIC8vIENyZWF0ZSBwbGFpbiBzb2NrZXQgaW8gb2JqZWN0IHdoaWNoIHdlIHdpbGwgd3JhcCBpbiB0aGlzXG4gICAgICB2YXIgc29ja2V0O1xuICAgICAgaWYgKGppZmZDbGllbnQuaG9zdG5hbWUuc3RhcnRzV2l0aChcImh0dHBcIikpIHtcbiAgICAgICAgdmFyIG1vZGlmaWVkSG9zdE5hbWUgPSBcIndzXCIgKyBqaWZmQ2xpZW50Lmhvc3RuYW1lLnN1YnN0cmluZyhqaWZmQ2xpZW50Lmhvc3RuYW1lLmluZGV4T2YoXCI6XCIpKVxuICAgICAgICBzb2NrZXQgPSBuZXcgd3MobW9kaWZpZWRIb3N0TmFtZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNvY2tldCA9IG5ldyB3cyhqaWZmQ2xpZW50Lmhvc3RuYW1lKTtcbiAgICAgIH1cblxuXG4gICAgICBzb2NrZXQub2xkX2Rpc2Nvbm5lY3QgPSBzb2NrZXQuY2xvc2U7XG5cbiAgICAgIHNvY2tldC5tYWlsYm94ID0gbGlua2VkTGlzdCgpOyAvLyBmb3Igb3V0Z29pbmcgbWVzc2FnZXNcbiAgICAgIHNvY2tldC5lbXB0eV9kZWZlcnJlZCA9IG51bGw7IC8vIGdldHMgcmVzb2x2ZWQgd2hlbmV2ZXIgdGhlIG1haWxib3ggaXMgZW1wdHlcbiAgICAgIHNvY2tldC5qaWZmQ2xpZW50ID0gamlmZkNsaWVudDtcblxuICAgICAgLy8gYWRkIGZ1bmN0aW9uYWxpdHkgdG8gc29ja2V0XG4gICAgICBzb2NrZXQuc2FmZV9lbWl0ID0gc2FmZV9lbWl0LmJpbmQoc29ja2V0KTtcbiAgICAgIHNvY2tldC5yZXNlbmRfbWFpbGJveCA9IHJlc2VuZF9tYWlsYm94LmJpbmQoc29ja2V0KTtcbiAgICAgIHNvY2tldC5kaXNjb25uZWN0ID0gZGlzY29ubmVjdC5iaW5kKHNvY2tldCk7XG4gICAgICBzb2NrZXQuc2FmZV9kaXNjb25uZWN0ID0gc2FmZV9kaXNjb25uZWN0LmJpbmQoc29ja2V0KTtcbiAgICAgIHNvY2tldC5pc19lbXB0eSA9IGlzX2VtcHR5LmJpbmQoc29ja2V0KTtcblxuICAgICAgcmV0dXJuIHNvY2tldDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYWZlX2VtaXQobGFiZWwsIG1zZykge1xuICAgICAgLy8gYWRkIG1lc3NhZ2UgdG8gbWFpbGJveFxuICAgICAgdmFyIG1haWxib3hfcG9pbnRlciA9IHRoaXMubWFpbGJveC5hZGQoeyBsYWJlbDogbGFiZWwsIG1zZzogbXNnIH0pO1xuICAgICAgaWYgKHRoaXMucmVhZHlTdGF0ZSA9PT0gMSkge1xuICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgIC8vIGVtaXQgdGhlIG1lc3NhZ2UsIGlmIGFuIGFja25vd2xlZGdtZW50IGlzIHJlY2VpdmVkLCByZW1vdmUgaXQgZnJvbSBtYWlsYm94XG5cbiAgICAgICAgdGhpcy5zZW5kKEpTT04uc3RyaW5naWZ5KHsgc29ja2V0UHJvdG9jb2w6IGxhYmVsLCBkYXRhOiBtc2cgfSksIG51bGwsIGZ1bmN0aW9uIChzdGF0dXMpIHtcblxuICAgICAgICAgIHNlbGYubWFpbGJveC5yZW1vdmUobWFpbGJveF9wb2ludGVyKTtcblxuICAgICAgICAgIGlmIChzZWxmLmlzX2VtcHR5KCkgJiYgc2VsZi5lbXB0eV9kZWZlcnJlZCAhPSBudWxsKSB7XG4gICAgICAgICAgICBzZWxmLmVtcHR5X2RlZmVycmVkLnJlc29sdmUoKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobGFiZWwgPT09ICdmcmVlJykge1xuICAgICAgICAgICAgc2VsZi5qaWZmQ2xpZW50Lmhvb2tzLmV4ZWN1dGVfYXJyYXlfaG9va3MoJ2FmdGVyT3BlcmF0aW9uJywgW3NlbGYuamlmZkNsaWVudCwgJ2ZyZWUnLCBtc2ddLCAyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzZW5kX21haWxib3goKSB7XG4gICAgICAvLyBDcmVhdGUgYSBuZXcgbWFpbGJveCwgc2luY2UgdGhlIGN1cnJlbnQgbWFpbGJveCB3aWxsIGJlIHJlc2VudCBhbmRcbiAgICAgIC8vIHdpbGwgY29udGFpbiBuZXcgYmFja3Vwcy5cbiAgICAgIHZhciBvbGRfbWFpbGJveCA9IHRoaXMubWFpbGJveDtcbiAgICAgIHRoaXMubWFpbGJveCA9IGxpbmtlZExpc3QoKTtcblxuICAgICAgLy8gbG9vcCBvdmVyIGFsbCBzdG9yZWQgbWVzc2FnZXMgYW5kIGVtaXQgdGhlbVxuICAgICAgdmFyIGN1cnJlbnRfbm9kZSA9IG9sZF9tYWlsYm94LmhlYWQ7XG4gICAgICB3aGlsZSAoY3VycmVudF9ub2RlICE9IG51bGwpIHtcbiAgICAgICAgdmFyIGxhYmVsID0gY3VycmVudF9ub2RlLm9iamVjdC5sYWJlbDtcbiAgICAgICAgdmFyIG1zZyA9IGN1cnJlbnRfbm9kZS5vYmplY3QubXNnO1xuICAgICAgICB0aGlzLnNhZmVfZW1pdChsYWJlbCwgbXNnKTtcbiAgICAgICAgY3VycmVudF9ub2RlID0gY3VycmVudF9ub2RlLm5leHQ7XG4gICAgICB9XG5cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkaXNjb25uZWN0KCkge1xuXG4gICAgICB0aGlzLmppZmZDbGllbnQuaG9va3MuZXhlY3V0ZV9hcnJheV9ob29rcygnYmVmb3JlT3BlcmF0aW9uJywgW3RoaXMuamlmZkNsaWVudCwgJ2Rpc2Nvbm5lY3QnLCB7fV0sIC0xKTtcblxuXG4gICAgICB0aGlzLm9sZF9kaXNjb25uZWN0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2FmZV9kaXNjb25uZWN0KGZyZWUsIGNhbGxiYWNrKSB7XG5cbiAgICAgIGlmICh0aGlzLmlzX2VtcHR5KCkpIHtcblxuICAgICAgICBpZiAoZnJlZSkge1xuICAgICAgICAgIHRoaXMuamlmZkNsaWVudC5mcmVlKCk7XG4gICAgICAgICAgZnJlZSA9IGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFQ6IFNob3VsZCByZW1haW4gXCJkaXNjb25uZWN0XCIgc2luY2Ugd2Ugb3ZlcnJpZGUgdGhlIC5kaXNjb25uZWN0LCBubyBuZWVkIHRvIGNoYW5nZSB0byBjbG9zZVxuICAgICAgICAgIHRoaXMuZGlzY29ubmVjdCgpO1xuICAgICAgICAgIGlmIChjYWxsYmFjayAhPSBudWxsKSB7XG4gICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy5lbXB0eV9kZWZlcnJlZCA9IG5ldyB0aGlzLmppZmZDbGllbnQuaGVscGVycy5EZWZlcnJlZCgpO1xuICAgICAgdGhpcy5lbXB0eV9kZWZlcnJlZC5wcm9taXNlLnRoZW4odGhpcy5zYWZlX2Rpc2Nvbm5lY3QuYmluZCh0aGlzLCBmcmVlLCBjYWxsYmFjaykpO1xuXG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNfZW1wdHkoKSB7XG4gICAgICByZXR1cm4gdGhpcy5tYWlsYm94LmhlYWQgPT0gbnVsbCAmJiB0aGlzLmppZmZDbGllbnQuY291bnRlcnMucGVuZGluZ19vcGVucyA9PT0gMDtcblxuICAgIH1cblxuICAgIC8qIFBSRVBST0NFU1NJTkcgSVMgVEhFIFNBTUUgKi9cbiAgICBqaWZmLnByZXByb2Nlc3NpbmdfZnVuY3Rpb25fbWFwW2V4cG9ydHMubmFtZV0gPSB7fTtcblxuXG4gICAgcmV0dXJuIGppZmY7XG4gIH1cbiAgLy8gRXhwb3NlIHRoZSBBUEkgZm9yIHRoaXMgZXh0ZW5zaW9uLlxuICBleHBvcnRzLm1ha2VfamlmZiA9IG1ha2VfamlmZjtcblxufSgodHlwZW9mIGV4cG9ydHMgPT09ICd1bmRlZmluZWQnID8gdGhpcy5qaWZmX3dlYnNvY2tldHMgPSB7fSA6IGV4cG9ydHMpLCB0eXBlb2YgZXhwb3J0cyAhPT0gJ3VuZGVmaW5lZCcpKTtcbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xuXG4vLyBjYWNoZWQgZnJvbSB3aGF0ZXZlciBnbG9iYWwgaXMgcHJlc2VudCBzbyB0aGF0IHRlc3QgcnVubmVycyB0aGF0IHN0dWIgaXRcbi8vIGRvbid0IGJyZWFrIHRoaW5ncy4gIEJ1dCB3ZSBuZWVkIHRvIHdyYXAgaXQgaW4gYSB0cnkgY2F0Y2ggaW4gY2FzZSBpdCBpc1xuLy8gd3JhcHBlZCBpbiBzdHJpY3QgbW9kZSBjb2RlIHdoaWNoIGRvZXNuJ3QgZGVmaW5lIGFueSBnbG9iYWxzLiAgSXQncyBpbnNpZGUgYVxuLy8gZnVuY3Rpb24gYmVjYXVzZSB0cnkvY2F0Y2hlcyBkZW9wdGltaXplIGluIGNlcnRhaW4gZW5naW5lcy5cblxudmFyIGNhY2hlZFNldFRpbWVvdXQ7XG52YXIgY2FjaGVkQ2xlYXJUaW1lb3V0O1xuXG5mdW5jdGlvbiBkZWZhdWx0U2V0VGltb3V0KCkge1xuICAgIHRocm93IG5ldyBFcnJvcignc2V0VGltZW91dCBoYXMgbm90IGJlZW4gZGVmaW5lZCcpO1xufVxuZnVuY3Rpb24gZGVmYXVsdENsZWFyVGltZW91dCAoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjbGVhclRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbihmdW5jdGlvbiAoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiBzZXRUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBkZWZhdWx0U2V0VGltb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjbGVhclRpbWVvdXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGRlZmF1bHRDbGVhclRpbWVvdXQ7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGRlZmF1bHRDbGVhclRpbWVvdXQ7XG4gICAgfVxufSAoKSlcbmZ1bmN0aW9uIHJ1blRpbWVvdXQoZnVuKSB7XG4gICAgaWYgKGNhY2hlZFNldFRpbWVvdXQgPT09IHNldFRpbWVvdXQpIHtcbiAgICAgICAgLy9ub3JtYWwgZW52aXJvbWVudHMgaW4gc2FuZSBzaXR1YXRpb25zXG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfVxuICAgIC8vIGlmIHNldFRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRTZXRUaW1lb3V0ID09PSBkZWZhdWx0U2V0VGltb3V0IHx8ICFjYWNoZWRTZXRUaW1lb3V0KSAmJiBzZXRUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBzZXRUaW1lb3V0O1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfSBjYXRjaChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQuY2FsbChudWxsLCBmdW4sIDApO1xuICAgICAgICB9IGNhdGNoKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3JcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwodGhpcywgZnVuLCAwKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG59XG5mdW5jdGlvbiBydW5DbGVhclRpbWVvdXQobWFya2VyKSB7XG4gICAgaWYgKGNhY2hlZENsZWFyVGltZW91dCA9PT0gY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIC8vIGlmIGNsZWFyVGltZW91dCB3YXNuJ3QgYXZhaWxhYmxlIGJ1dCB3YXMgbGF0dGVyIGRlZmluZWRcbiAgICBpZiAoKGNhY2hlZENsZWFyVGltZW91dCA9PT0gZGVmYXVsdENsZWFyVGltZW91dCB8fCAhY2FjaGVkQ2xlYXJUaW1lb3V0KSAmJiBjbGVhclRpbWVvdXQpIHtcbiAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gY2xlYXJUaW1lb3V0O1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIC8vIHdoZW4gd2hlbiBzb21lYm9keSBoYXMgc2NyZXdlZCB3aXRoIHNldFRpbWVvdXQgYnV0IG5vIEkuRS4gbWFkZG5lc3NcbiAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gV2hlbiB3ZSBhcmUgaW4gSS5FLiBidXQgdGhlIHNjcmlwdCBoYXMgYmVlbiBldmFsZWQgc28gSS5FLiBkb2Vzbid0ICB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKG51bGwsIG1hcmtlcik7XG4gICAgICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3IuXG4gICAgICAgICAgICAvLyBTb21lIHZlcnNpb25zIG9mIEkuRS4gaGF2ZSBkaWZmZXJlbnQgcnVsZXMgZm9yIGNsZWFyVGltZW91dCB2cyBzZXRUaW1lb3V0XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0LmNhbGwodGhpcywgbWFya2VyKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG5cbn1cbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGlmICghZHJhaW5pbmcgfHwgIWN1cnJlbnRRdWV1ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHJ1blRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRRdWV1ZSkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIHJ1bkNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHJ1blRpbWVvdXQoZHJhaW5RdWV1ZSk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcbnByb2Nlc3MucHJlcGVuZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucHJlcGVuZE9uY2VMaXN0ZW5lciA9IG5vb3A7XG5cbnByb2Nlc3MubGlzdGVuZXJzID0gZnVuY3Rpb24gKG5hbWUpIHsgcmV0dXJuIFtdIH1cblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgJ3dzIGRvZXMgbm90IHdvcmsgaW4gdGhlIGJyb3dzZXIuIEJyb3dzZXIgY2xpZW50cyBtdXN0IHVzZSB0aGUgbmF0aXZlICcgK1xuICAgICAgJ1dlYlNvY2tldCBvYmplY3QnXG4gICk7XG59O1xuIl19
