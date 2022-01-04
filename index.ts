/*!
 * Copyright (c) 2021, imqueue.com <support@imqueue.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
import gcpTracer from '@google-cloud/trace-agent';
import {
    RootSpan,
    Span,
    Tracer,
} from '@google-cloud/trace-agent/build/src/plugin-types';
import * as path from 'path';
export * from '@google-cloud/trace-agent';

export interface TraceTags {
    [name: string]: string;
}

const traces: { [name: string]: Span } = {};

// noinspection JSUnusedGlobalSymbols
/**
 * Short-hand for making in-code traces. Starts datadog trace span with the
 * given name, and assigns it given tags (if passed).
 *
 * @example
 * ```typescript
 * import { trace, traceEnd } from '@imqueue/gcp-trace';
 *
 * trace('my-trace');
 * // ... do some work
 * traceEnd('my-trace');
 * ```
 *
 * @param {string} name - trace name (datadog span name
 * @param {TraceTags} [tags] - datadog trace span tags, if passed
 */
export function trace(name: string, tags?: TraceTags) {
    if (traces[name]) {
        throw new TypeError(
            `Trace with name ${name} has been already started!`,
        );
    }

    const tracer = gcpTracer.start();
    const rootSpan: RootSpan = tracer.getCurrentRootSpan();

    if (tracer.isRealSpan(rootSpan)) {
        traces[name] = rootSpan.createChildSpan({ name });
    } else {
        traces[name] = tracer.createChildSpan({ name });
    }
}

// noinspection JSUnusedGlobalSymbols
/**
 * Short-hand for finishing datadog trace span.
 *
 * @param {string} name
 */
export function traceEnd(name: string) {
    if (traces[name]) {
        traces[name].endSpan();
        delete traces[name];
    }
}

export enum TraceKind {
    // noinspection JSUnusedGlobalSymbols
    SERVER = 'server',
    CLIENT = 'client',
}

export interface TracedOptions {
    kind: TraceKind;
    tags?: TraceTags;
}

const DEFAULT_TRACED_OPTIONS: TracedOptions = {
    kind: TraceKind.SERVER,
};

let pkgName = '';

try {
    pkgName = require(`${path.resolve('.')}${path.sep}package.json`).name;
} catch (err) { /* ignore */ }

// noinspection JSUnusedGlobalSymbols
/**
 * Decorator factory, which return decorator function allowing to add tracing to
 * decorated method calls.
 */
export function traced(options?: Partial<TracedOptions>) {
    return (
        target: any,
        methodName: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: any[]) => any>,
    ) => {
        const original = descriptor.value;
        const opts: TracedOptions = Object.assign(
            {}, DEFAULT_TRACED_OPTIONS, options || {},
        );
        const tracer = gcpTracer.get();

        descriptor.value = function<T>(...args: any[]) {
            const className = this.constructor.name;
            const tags = Object.assign({
                'span.kind': opts.kind,
                'resource.name': `${className}.${String(methodName)}`,
                ...(pkgName ? { 'package.name': pkgName } : {}),
                'component': 'imq',
            }, opts.tags || {});
            const rootSpan = tracer.getCurrentRootSpan();
            const span = rootSpan.createChildSpan({ name: 'method.call' });

            for (const tagKey of Object.keys(tags)) {
                span.addLabel(tagKey, tags[tagKey]);
            }

            try {
                const result: any = original && original.apply(this, args);

                if (result && result.then) {
                    // noinspection CommaExpressionJS
                    return result.then((res: any) => (span.endSpan(), res))
                    .catch((err: any) => handleError(span, err, tracer));
                }

                span.endSpan();

                return result;
            } catch (err) {
                handleError(span, err, tracer);
            }
        };
    };
}

/**
 * Handles error gracefully, finishing tracing span before throwing
 *
 * @param {Span} span
 * @param {any} err
 * @param {Tracer} tracer
 * @throws {any}
 */
function handleError(span: Span, err: any, tracer: Tracer) {
    span.addLabel(tracer.labels.ERROR_DETAILS_NAME, err);
    span.endSpan();

    throw err;
}
