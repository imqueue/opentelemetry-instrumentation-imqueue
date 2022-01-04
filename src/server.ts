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
import {
    IMQService,
    IMQRPCRequest,
    IMQBeforeCall,
    IMQAfterCall,
    IMQServiceOptions,
} from '@imqueue/rpc';
import gcpTracer from '@google-cloud/trace-agent';
import {
    Span,
    Tracer,
} from '@google-cloud/trace-agent/build/src/plugin-types';

type ServiceModule = {
    DEFAULT_IMQ_SERVICE_OPTIONS: IMQServiceOptions;
} | any;

/**
 * Before call hook definition for @imqueue service
 *
 * @param {IMQRPCRequest} req - imq request
 * @return Promise<void>
 */
const beforeCall: IMQBeforeCall<IMQService> = async function(
    this: IMQService,
    req: IMQRPCRequest,
): Promise<void> {
    (req as any).toJSON = () => {
        const copy = Object.assign({}, req);
        delete copy.span;
        return copy;
    };

    const tracer = gcpTracer.get();
    const clientSpanMeta = (req.metadata || { clientSpan: null }).clientSpan;
    const redisSpan = getRedisSpan();
    let childOf = (clientSpanMeta ? clientSpanMeta : redisSpan) as Span;

    // noinspection TypeScriptUnresolvedVariable
    if (
        redisSpan && childOf && tracer.isRealSpan(childOf) &&
        redisSpan !== childOf
    ) {
        try {
            redisSpan.endSpan();
            childOf = redisSpan;
        } catch (err) { /* ignore */ }
    }

    const traceContext = childOf.getTraceContext();

    if (traceContext) {
        tracer.runInRootSpan({
            name: 'imq.response', traceContext,
        }, rootSpan => {
            const span = rootSpan.createChildSpan({ name: 'imq.response' });

            span.addLabel('span.kind', 'server');
            span.addLabel('resource.name', `${ this.name }.${ req.method }`);
            span.addLabel('service.name', this.name);
            span.addLabel('imq.client', req.from);
            span.addLabel('component', 'imq');

            (req as any).span = span;
        });
    }
};

function getRedisSpan(): Span | undefined {
    const tracer = gcpTracer.get();
    const spans: Span[] = (tracer.getCurrentRootSpan() as any).trace.spans;
    let redisSpan: Span | undefined;

    for (let i = spans.length - 1; i >= 0; i--) {
        const span: any = spans[i];

        if ((span.name || '').includes('redis-')) {
            redisSpan = span as Span;
        }
    }

    return redisSpan;
}

/**
 * After call hook definition for @imqueue service
 *
 * @param {IMQRPCRequest} req - imq request
 * @return {Promise<void>}
 */
const afterCall: IMQAfterCall<IMQService> = async function(
    this: IMQService,
    req: IMQRPCRequest,
): Promise<void> {
    const span: Span = (req as any).span;

    span && span.endSpan();
};

const server = [{
    name: '@imqueue/rpc',
    versions: ['>=1.10'],
    file: 'src/IMQRPCOptions.js',
    patch(pkg: ServiceModule, tracer: Tracer, config: any) {
        if (config.client === false) {
            return ;
        }

        // noinspection JSUnusedGlobalSymbols
        Object.assign(
            pkg.DEFAULT_IMQ_SERVICE_OPTIONS,
            { beforeCall, afterCall },
        );

        return pkg;
    },
    unpatch(pkg: ServiceModule) {
        // tslint:disable-next-line:no-shadowed-variable
        const { beforeCall, afterCall } = pkg.DEFAULT_IMQ_SERVICE_OPTIONS;

        if (beforeCall) {
            delete pkg.DEFAULT_IMQ_SERVICE_OPTIONS.beforeCall;
        }

        if (afterCall) {
            delete pkg.DEFAULT_IMQ_SERVICE_OPTIONS.afterCall;
        }

        return pkg;
    },
}];

export default server;
