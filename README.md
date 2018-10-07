# @smpx/tail
Watch and tail a file in nodejs `tail -f -n` 🎉 **No Dependencies**

### Install
```sh
npm install @smpx/tail
```

Or with yarn:
```sh
yarn add @smpx/tail
```

### Use
```js
const tail = require('@smpx/tail');

const stream = tail('/var/log/syslog', {
    numLines: 20,
    watch: true,
});

stream.on('line', (line) => {
    console.log(line);
});

stream.on('error', (err) => {
    console.error(err);
});
```

If you want to stop watching:
```js
stream.close();
```


### API

##### tail(filename, options)
* `filename`: Path of the file to tail
* `options`:
  * `bufferSize`: Use this bufferSize when reading from the file (default `2048`)
  * `encoding`: Encoding of the file (default `utf8`)
  * `numLines`: Number of lines to read initially (default `10`) (similar to `tail -n`)
  * `watch`: Whether to watch the file for changes (default `false`) (similar to `tail -f`)
    * Setting this to true will keep the process alive until you call `close`
  * `filter`: An optional function to emit only those lines which pass the criteria
    * ```js
      const stream = tail('/var/log/syslog', {
          numLines: 20,
          watch: true,
          filter: (line) => {
              if (!line) return false;
              return JSON.parse(line).level === 'error';
          }
      });
      ```

**Returns**:

An eventemitter, with two events, `line` and `error` and a function `close`.

* `on('line', (line) => {})`: emitted whenever we read a new line from the file
* `on('error', (err) => {})`: emitted whenever there's an error
* `close`: a method to close and unwatch the file

### LICENSE

MIT
