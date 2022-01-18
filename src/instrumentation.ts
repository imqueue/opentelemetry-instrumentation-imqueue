/*!
 * Copyright (c) 2022, imqueue.com <support@imqueue.com>
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
    InstrumentationBase,
    InstrumentationConfig,
    InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import * as imq from '@imqueue/rpc';
import {
    IMQBeforeCall,
    IMQClient,
    IMQRPCRequest,
    IMQServiceOptions,
} from '@imqueue/rpc';
import {
    context,
    propagation,
    SpanKind,
    trace,
    Tracer,
} from '@opentelemetry/api';
import { Span } from '@opentelemetry/tracing';
import { AttributeNames, SpanNames, TraceKind } from './enums';

const instrumentationName = '@imqueque/rpc';
const instrumentationVersion = '1.0.0';
const versions = ['>=1.10'];
const componentName = 'imq';

type ServiceModule = {
    DEFAULT_IMQ_CLIENT_OPTIONS: IMQServiceOptions;
    DEFAULT_IMQ_SERVICE_OPTIONS: IMQServiceOptions;
};

export class ImquequeInstrumentation extends InstrumentationBase<typeof imq> {
    private static thisTracer: Tracer;

    constructor(config: InstrumentationConfig = {}) {
        super(
            instrumentationName,
            instrumentationVersion,
            Object.assign({}, config),
        );
    }

    protected init() {
        const module = new InstrumentationNodeModuleDefinition<ServiceModule>(
            instrumentationName, versions,
            moduleExports => {
                const { beforeCallClient, beforeCallService, afterCall } = this;

                Object.assign(
                    moduleExports.DEFAULT_IMQ_CLIENT_OPTIONS,
                    { beforeCall: beforeCallClient, afterCall },
                );

                Object.assign(
                    moduleExports.DEFAULT_IMQ_SERVICE_OPTIONS,
                    { beforeCall: beforeCallService, afterCall },
                );

                return moduleExports;
            },
            moduleExports => {
                ImquequeInstrumentation.unpatchClient(moduleExports);
                ImquequeInstrumentation.unpatchService(moduleExports);

                return moduleExports;
            },
        );

        ImquequeInstrumentation.thisTracer = this.tracer;

        return module;
    }

    private beforeCallClient: IMQBeforeCall<IMQClient> = async function(
        this: IMQClient,
        req: IMQRPCRequest
    ): Promise<void> {
        (req as any).toJSON = () => {
            const copy = Object.assign({}, req);
            delete copy.span;
            return copy;
        };

        const span = ImquequeInstrumentation.thisTracer.startSpan(
            SpanNames.IMQ_REQUEST,
            {
                attributes: {
                    [AttributeNames.SPAN_KIND]: TraceKind.CLIENT,
                    [AttributeNames.RESOURCE_NAME]: `${ this.serviceName }.${
                        req.method }`,
                    [AttributeNames.SERVICE_NAME]: this.serviceName,
                    [AttributeNames.IMQ_CLIENT]: req.from,
                    [AttributeNames.COMPONENT]: componentName,
                },
                kind: SpanKind.CLIENT,
            },
        );

        req.metadata = req.metadata || {};
        req.metadata.clientSpan = {};

        propagation.inject(
            trace.setSpan(context.active(), span),
            req.metadata.clientSpan,
        );

        (req as any).span = span;
    };

    private beforeCallService: IMQBeforeCall<IMQClient> = async function(
        this: IMQClient,
        req: IMQRPCRequest
    ): Promise<void> {
        (req as any).toJSON = () => {
            const copy = Object.assign({}, req);
            delete copy.span;
            return copy;
        };

        const carrier = (req.metadata || { clientSpan: null }).clientSpan;
        const parentContext = propagation.extract(context.active(), carrier);

        (req as any).span = ImquequeInstrumentation.thisTracer.startSpan(
            SpanNames.IMQ_RESPONSE,
            {
                attributes: {
                    [AttributeNames.SPAN_KIND]: TraceKind.SERVER,
                    [AttributeNames.RESOURCE_NAME]: `${ this.name }.${
                        req.method }`,
                    [AttributeNames.SERVICE_NAME]: this.name,
                    [AttributeNames.IMQ_CLIENT]: req.from,
                    [AttributeNames.COMPONENT]: componentName,
                },
                kind: SpanKind.SERVER,
            },
            parentContext,
        );
    };

    private afterCall: IMQBeforeCall<IMQClient> = async function(
        this: IMQClient,
        req: IMQRPCRequest,
    ): Promise<void> {
        ((req as any).span as Span | undefined)?.end();
    };

    private static unpatchClient(serviceModule: ServiceModule): void {
        const {
            beforeCall,
            afterCall,
        } = serviceModule.DEFAULT_IMQ_CLIENT_OPTIONS;

        if (beforeCall) {
            delete serviceModule.DEFAULT_IMQ_CLIENT_OPTIONS.beforeCall;
        }

        if (afterCall) {
            delete serviceModule.DEFAULT_IMQ_CLIENT_OPTIONS.afterCall;
        }
    }

    private static unpatchService(serviceModule: ServiceModule): void {
        const {
            beforeCall,
            afterCall,
        } = serviceModule.DEFAULT_IMQ_SERVICE_OPTIONS;

        if (beforeCall) {
            delete serviceModule.DEFAULT_IMQ_SERVICE_OPTIONS.beforeCall;
        }

        if (afterCall) {
            delete serviceModule.DEFAULT_IMQ_SERVICE_OPTIONS.afterCall;
        }
    }
}
