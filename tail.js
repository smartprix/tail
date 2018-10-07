const fs = require('fs');
const {EventEmitter} = require('events');

/**
 * tail a file
 * @example
 * const stream = tail('/var/log/syslog', {
 *   numLines: 10,
 *   watch: true,
 * });
 *
 * stream.on('line', (line) => {
 *   console.log(line);
 * });
 *
 * stream.on('error', (err) => {
 *   console.error(err);
 * });
 */

function watch(ctx) {
	// console.log('watch', ctx);
	ctx.offset = ctx.size;
	ctx.forward = true;
	ctx.leftover = Buffer.alloc(0);
	ctx.bytesToRead = ctx.bufferSize;
	ctx.watcher = fs.watch(ctx.file, {encoding: ctx.encoding}, (event) => {
		if (event === 'change') {
			if (ctx.readTimer) return;
			ctx.readTimer = setTimeout(() => {
				ctx.readTimer = null;
				// eslint-disable-next-line no-use-before-define
				stat(ctx);
			}, 50);
		}
		else if (event === 'rename') {
			ctx.events.emit('error', new Error('File deleted or renamed'));
			return;
		}
	});
}

function readTrunk(ctx) {
	// console.log('readTrunk', ctx.offset, ctx.size);
	if (!ctx.fd) return;

	if (!ctx.numLines && !ctx.forward) {
		watch(ctx);
		return;
	}

	if (ctx.readingTrunk) {
		return;
	}

	ctx.readingTrunk = true;
	fs.read(
		ctx.fd, ctx.buffer, 0, ctx.bytesToRead, ctx.offset,
		(err, bytesRead, buffer) => {
			if (err) {
				ctx.events.emit('error', err);
				return;
			}

			ctx.readingTrunk = false;
			// eslint-disable-next-line no-use-before-define
			handleRead(bytesRead, buffer, ctx);
		},
	);
}

function splitLine(str) {
	// console.log('splitLine');
	return str.split(/\r?\n/);
}

function splitBuffer(buf, ctx) {
	// console.log('splitBuffer');
	if (ctx.forward) {
		const l = buf.lastIndexOf(ctx.bufLF);
		if (l < 0) return [];

		if (buf[l - 1] === ctx.bufCR) return [l + 1, l - 1];
		return [l + 1, l];
	}

	const l = buf.indexOf(ctx.bufLF, 1);
	if (l < 0) return [];
	if (buf[l - 1] === ctx.bufCR) return [l - 1, l + 1];
	return [l, l + 1];
}

function close(ctx) {
	if (ctx.watcher) {
		ctx.watcher.close();
	}

	if (ctx.fd) {
		// console.log('close');
		fs.close(ctx.fd, (err) => {
			if (err) {
				ctx.events.emit('error', err);
			}
			ctx.fd = null;
			ctx = null;
		});
	}
}

function emitLines(ctx) {
	// console.log('emitLines');
	const totalLines = ctx.lines.length;
	let start = 0;
	if (!ctx.forward) {
		start = Math.max(totalLines - ctx.numLines, 0);
	}
	for (let i = start; i < totalLines; i++) {
		ctx.events.emit('line', ctx.lines[i]);
	}

	// reset lines
	ctx.lines = [];

	// close file if we don't need to watch it
	if (!ctx.watch) {
		close(ctx);
		return;
	}

	// start watching the file if not already watching
	if (!ctx.forward) {
		watch(ctx);
	}
}

function removeEmptyEndLine(ctx) {
	const endLine = ctx.lines.pop();
	if (endLine) ctx.lines.push(endLine);
}

function handleLines(ctx) {
	// console.log('handleLines');
	if (ctx.forward) {
		emitLines(ctx);
		if (!ctx.hasEnd) {
			readTrunk(ctx);
		}
		return;
	}

	if (ctx.hasEnd || ctx.lines.length >= ctx.numLines) {
		removeEmptyEndLine(ctx);
		emitLines(ctx);
		return;
	}

	readTrunk(ctx);
}

function concatLines(str, ctx) {
	let lines = splitLine(str);
	if (ctx.filter) {
		lines = lines.filter(ctx.filter);
	}
	if (!lines.length) return;
	if (ctx.forward) {
		ctx.lines = ctx.lines.concat(lines);
	}
	else {
		ctx.lines = lines.concat(ctx.lines);
	}
}

function handleRead(bytesRead, buffer, ctx) {
	// console.log('handleRead');
	buffer = buffer.slice(0, bytesRead);

	let buf;
	let hasEnd = false;
	if (ctx.forward) {
		buf = Buffer.concat([ctx.leftover, buffer]);
		ctx.offset += bytesRead;
		ctx.size = Math.max(ctx.size, ctx.offset);
		hasEnd = (ctx.offset >= ctx.size);
	}
	else {
		buf = Buffer.concat([buffer, ctx.leftover]);
		hasEnd = (ctx.offset === 0);
		ctx.bytesToRead = Math.min(ctx.offset, ctx.bufferSize);
		ctx.offset = Math.max(ctx.offset - bytesRead, 0);
	}

	ctx.hasEnd = hasEnd;
	if (hasEnd && !ctx.forward) {
		concatLines(buf.toString(ctx.encoding), ctx);
		handleLines(ctx);
		return;
	}

	const [sl, sr] = splitBuffer(buf, ctx);
	if (!sl) {
		if (hasEnd) return;
		ctx.leftover = buf;
		readTrunk(ctx);
		return;
	}

	let str;
	if (ctx.forward) {
		ctx.leftover = buf.slice(sl);
		str = buf.slice(0, sr).toString(ctx.encoding);
	}
	else {
		ctx.leftover = buf.slice(0, sl);
		str = buf.slice(sr).toString(ctx.encoding);
	}

	concatLines(str, ctx);
	handleLines(ctx);
}

function handleStats(stats, ctx) {
	// console.log('handleStats');
	if (!ctx.forward) {
		ctx.size = stats.size;
		ctx.bytesToRead = Math.min(ctx.size, ctx.bufferSize);
		ctx.offset = Math.max(ctx.size - ctx.bufferSize, 0);
		ctx.buffer = Buffer.alloc(ctx.bufferSize);
		ctx.leftover = Buffer.alloc(0);
		ctx.lines = [];

		readTrunk(ctx);
		return;
	}

	if (stats.size > ctx.size) {
		ctx.size = stats.size;
		readTrunk(ctx);
	}
}

function stat(ctx) {
	// console.log('handleFd');
	if (!ctx.fd) return;

	fs.fstat(ctx.fd, (err, stats) => {
		if (err) {
			ctx.events.emit('error', err);
			return;
		}

		handleStats(stats, ctx);
	});
}

function open(ctx) {
	// console.log('open');
	fs.open(ctx.file, 'r', (err, fd) => {
		if (err) {
			ctx.events.emit('error', err);
			return;
		}

		ctx.fd = fd;
		stat(ctx);
	});
}

function tail(file, options = {}) {
	const ctx = Object.assign({
		encoding: 'utf8',
		bufferSize: 1024,
		numLines: 10,
		filter: null,
	}, options);

	[ctx.bufCR, ctx.bufLF] = Buffer.from('\r\n', ctx.encoding);
	ctx.events = new EventEmitter();
	ctx.file = file;
	ctx.events.close = () => {
		close(ctx);
	};

	open(ctx);
	return ctx.events;
}

module.exports = tail;
