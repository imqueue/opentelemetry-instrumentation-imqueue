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
    IMQClient,
    IMQRPCRequest,
    IMQBeforeCall,
    IMQServiceOptions,
} from '@imqueue/rpc';
import gcpTracer from '@google-cloud/trace-agent';
import { Span, Tracer } from '@google-cloud/trace-agent/build/src/plugin-types';

type ClientModule = {
    DEFAULT_IMQ_CLIENT_OPTIONS: IMQServiceOptions;
} | any;

/**
 * Before call hook definition for @imqueue client
 *
 * @param {IMQRPCRequest} req - imq request
 * @return Promise<void>
 */
const beforeCall: IMQBeforeCall<IMQClient> = async function(
    this: IMQClient,
    req: IMQRPCRequest
): Promise<void> {
    (req as any).toJSON = () => {
        const copy = Object.assign({}, req);
        delete copy.span;
        return copy;
    };

    const tracer = gcpTracer.get();
    const rootSpan = tracer.getCurrentRootSpan();
    const span = tracer.isRealSpan(rootSpan)
        ? rootSpan.createChildSpan({ name: 'imq.request' })
        : tracer.createChildSpan({ name: 'imq.request' });

    span.addLabel('span.kind', 'client');
    span.addLabel('resource.name', `${this.serviceName}.${req.method}`);
    span.addLabel('service.name', this.serviceName);
    span.addLabel('imq.client', req.from);
    span.addLabel('component', 'imq');

    (req as any).span = span;
};

/**
 * After call hook definition for @imqueue client
 *
 * @param {IMQRPCRequest} req - imq request
 * @return {Promise<void>}
 */
const afterCall: IMQBeforeCall<IMQClient> = async function(
    this: IMQClient,
    req: IMQRPCRequest,
): Promise<void> {
    const span: Span = (req as any).span;

    span && span.endSpan();
};

const client = [{
    name: '@imqueue/rpc',
    versions: ['>=1.10'],
    file: 'src/IMQRPCOptions.js',
    patch(pkg: ClientModule, tracer: Tracer, config: any) {
        if (config.client === false) {
            return ;
        }

        // noinspection JSUnusedGlobalSymbols
        Object.assign(
            pkg.DEFAULT_IMQ_CLIENT_OPTIONS,
            { beforeCall, afterCall },
        );

        return pkg;
    },
    unpatch(pkg: ClientModule) {
        // tslint:disable-next-line:no-shadowed-variable
        const { beforeCall, afterCall } = pkg.DEFAULT_IMQ_CLIENT_OPTIONS;

        if (beforeCall) {
            delete pkg.DEFAULT_IMQ_CLIENT_OPTIONS.beforeCall;
        }

        if (afterCall) {
            delete pkg.DEFAULT_IMQ_CLIENT_OPTIONS.afterCall;
        }

        return pkg;
    },
}];

export default client;
