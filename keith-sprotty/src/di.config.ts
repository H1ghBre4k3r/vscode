/*
 * KIELER - Kiel Integrated Environment for Layout Eclipse RichClient
 *
 * http://rtsys.informatik.uni-kiel.de/kieler
 *
 * Copyright 2019 by
 * + Kiel University
 *   + Department of Computer Science
 *     + Real-Time and Embedded Systems Group
 *
 * This code is provided under the terms of the Eclipse Public License (EPL).
 */
import { Container, ContainerModule, interfaces } from 'inversify';
import {
    configureModelElement, ConsoleLogger, defaultModule, exportModule, LogLevel, modelSourceModule, overrideViewerOptions, selectModule, SGraph, SGraphFactory, TYPES,
    updateModule, viewportModule
} from 'sprotty/lib';
import actionModule from './actions/actions-module';
import { KEdge, KLabel, KNode, KPort } from './kgraph-models';
import textBoundsModule from './textbounds/textbounds-module';
import { KEdgeView, KLabelView, KNodeView, KPortView, SKGraphView } from './views';
import { interactiveModule } from '@kieler/keith-interactive/lib/interactive-module'

/**
 * Dependency injection module that adds functionality for diagrams and configures the views for KGraphElements.
 */
const kGraphDiagramModule = new ContainerModule((bind: interfaces.Bind, unbind: interfaces.Unbind, isBound: interfaces.IsBound, rebind: interfaces.Rebind) => {
    rebind(TYPES.ILogger).to(ConsoleLogger).inSingletonScope()
    rebind(TYPES.LogLevel).toConstantValue(LogLevel.warn)
    rebind(TYPES.IModelFactory).to(SGraphFactory).inSingletonScope()
   // bind(NewMouseListener).toSelf().inSingletonScope()
    const context = { bind, unbind, isBound, rebind };
    configureModelElement(context, 'graph', SGraph, SKGraphView);
    configureModelElement(context, 'node', KNode, KNodeView)
    configureModelElement(context, 'edge', KEdge, KEdgeView)
    configureModelElement(context, 'port', KPort, KPortView)
    configureModelElement(context, 'label', KLabel, KLabelView)
})

/**
 * Dependency injection container that bundles all needed sprotty and custom modules to allow KGraphs to be drawn with sprotty.
 */
export default function createContainer(widgetId: string): Container {
    const container = new Container()
    container.load(defaultModule, selectModule, interactiveModule, viewportModule, exportModule, modelSourceModule, updateModule, kGraphDiagramModule, textBoundsModule, actionModule)
    overrideViewerOptions(container, {
        needsClientLayout: false,
        needsServerLayout: true,
        baseDiv: widgetId,
        hiddenDiv: widgetId + '_hidden'
    })
    return container
}