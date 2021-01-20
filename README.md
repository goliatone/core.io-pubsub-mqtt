## core.io PubSub MQTT

This package is part of the [core.io][https://github.com/goliatone/application-cor] set of libraries, meaning it can be used independently or inside an **core.io** application.

To install:

```
$ npm i -S core.io-pubsub-mqtt
```

### Documentation

This module provides a request/response flow that you can leverage to replicate HTTP mechanics. The following illustrates a simple example

* client.js:

```js
pubsub.request('ci/registry/list').then(response => {
    console.log(repsonse.message) //This is my reponse
}).catch(error => {
    //handle error
});
```

* server.js:

```js
pubsub.subscribe('ci/registry/list', event => {
    //...perform logic to generate a result object
    let result = { message: 'This is my response' };
    event.respond({ result });
});
```

If you are using the package as a core.io module and using the dispatch/command flow, you can configure the module to behave use core.io dispatcher handling events with a `respondTo` function so that your commands do not have to worry about specificly handling the `respond` call.

Your application setup:

`./commands/api.image.get.js`
```js
class ApiImageGetCommand {
    execute(event) {
        return { 
            success: true, 
            message: 'This is my command response' 
        };
    }
}
```

`./config/pubsub.js`:

```js
module.exports = {
    responseTopicKey: 'responseTopic',
    responseCallerKey: 'respondTo',
    handlers: {
        'mqtt/api/image/get': function handler(topic message) {
            const context = this;
            context.emit('api.image.get', message);
        }
    }
};
```



Then from your application dispatching the request:

```js
let res = await pubsub.request('api.image.get', {filename});
```

## License
® License MIT 2017 by goliatone
