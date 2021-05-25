/*
 * KIELER - Kiel Integrated Environment for Layout Eclipse RichClient
 *
 * http://rtsys.informatik.uni-kiel.de/kieler
 *
 * Copyright 2018-2020 by
 * + Kiel University
 *   + Department of Computer Science
 *     + Real-Time and Embedded Systems Group
 *
 * This code is provided under the terms of the Eclipse Public License (EPL).
 */

import { RefreshDiagramAction } from '@kieler/keith-interactive/lib/actions';
import {
    DeleteLayerConstraintAction, DeletePositionConstraintAction, DeleteStaticConstraintAction,
    SetPositionConstraintAction, SetLayerConstraintAction, SetStaticConstraintAction
} from '@kieler/keith-interactive/lib/layered/actions';
import { RectPackDeletePositionConstraintAction, RectPackSetPositionConstraintAction, SetAspectRatioAction } from '@kieler/keith-interactive/lib/rect-packing/actions';
import {
    CheckedImagesAction, CheckImagesAction, ComputedTextBoundsAction, KeithUpdateModelAction, Pair, PerformActionAction, RefreshLayoutAction, RequestTextBoundsCommand,
    SetSynthesesAction, SetSynthesisAction, StoreImagesAction, RequestDiagramPieceAction, SetDiagramPieceAction
} from '@kieler/keith-sprotty/lib/actions/actions';
import { RequestKeithPopupModelAction } from '@kieler/keith-sprotty/lib/hover/hover';
import { injectable } from 'inversify';
import { LSTheiaDiagramServer } from 'sprotty-theia/lib';
import {
    Action, ActionHandlerRegistry, ActionMessage, BringToFrontAction, ComputedBoundsAction, findElement, FitToScreenAction,
    generateRequestId,
    ICommand, RequestPopupModelAction, SetModelCommand,
    SetPopupModelAction, SwitchEditModeAction, /* UpdateModelAction */
} from 'sprotty/lib';
import { isNullOrUndefined } from 'util';
import { diagramPadding } from '../common/constants';
import { KeithDiagramWidget } from './keith-diagram-widget';
import { KeithTheiaSprottyConnector } from './keith-theia-sprotty-connector';
import { Emitter, Event } from '@theia/core/lib/common';

export const KeithDiagramServerProvider = Symbol('KeithDiagramServerProvider');

export type KeithDiagramServerProvider = () => Promise<KeithDiagramServer>;

// TODO: these really should be instance properties, not global constants.
export const onDisplayInputModelEmitter = new Emitter<Action | undefined>()
export const displayInputModel: Event<Action | undefined> = onDisplayInputModelEmitter.event
export const startSimulationEmitter = new Emitter<Action | undefined>()
export const startSimulation: Event<Action | undefined> = startSimulationEmitter.event
export const addCoSimulationEmitter = new Emitter<Action | undefined>()
export const addCoSimulation: Event<Action | undefined> = addCoSimulationEmitter.event

export const updateOptionsKind = 'updateOptions'
export const onUpdateOptionsEmitter = new Emitter<Action | undefined>()
export const updateOptions: Event<Action | undefined> = onUpdateOptionsEmitter.event


/**
 * This class extends the Theia diagram Server to also handle the Request- and ComputedTextBoundsAction
 */
@injectable()
export class KeithDiagramServer extends LSTheiaDiagramServer {

    // FIXME: this is the most naive implementation, can be replaced by more advanced mechanisms in the future
    childrenToRequestQueue: string[] = []

    messageReceived(message: ActionMessage) {
        const wasUpdateModelAction = message.action.kind === KeithUpdateModelAction.KIND;
        super.messageReceived(message)
        // Special handling for the SetModel action.
        if (message.action.kind === SetModelCommand.KIND || wasUpdateModelAction) {
            // Fire the widget's event that a new model was received.
            const diagramWidget = this.getWidget()
            if (diagramWidget instanceof KeithDiagramWidget) {
                if (wasUpdateModelAction && (message.action as KeithUpdateModelAction).cause
                    && (message.action as KeithUpdateModelAction).cause.kind) {
                    return
                }
                if (message.action.kind === SetModelCommand.KIND) {
                    diagramWidget.modelUpdated()
                    // After model is received request first piece.
                    
                    // TODO: Here some state aware process should handle requesting pieces
                    //       This needs to be initialized here, probably also do this stuff
                    //       with commands
                    // get root diagram piece
                    this.actionDispatcher.dispatch(new RequestDiagramPieceAction(generateRequestId(), '$root'))
                }
                if (diagramWidget.resizeToFit) {
                    // Fit the received model to the widget size.
                    this.actionDispatcher.dispatch(new FitToScreenAction(['$root'], diagramPadding, undefined, true))
                }
            }
        }
        if (message.action.kind === SetDiagramPieceAction.KIND) {
            // get next piece
            // TODO: Here some state aware process should handle requesting pieces

            // this.actionDispatcher.dispatch(new RequestDiagramPieceAction())
            // add any children of the requested piece as stubs into queue
            if ((message.action as SetDiagramPieceAction).diagramPiece.children !== undefined) {
                const children = (message.action as SetDiagramPieceAction).diagramPiece.children!
                children.forEach(element => {
                    this.childrenToRequestQueue.push(element.id)
                });
            }
            if (this.childrenToRequestQueue.length > 0) {
                let childId = this.childrenToRequestQueue.pop()!
                this.actionDispatcher.dispatch(new RequestDiagramPieceAction(generateRequestId(), childId))
            }
        }
    }

    handleLocally(action: Action): boolean {
        switch (action.kind) {
            case ComputedBoundsAction.KIND: // TODO: remove sending of a computedBoundsAction as well (not possible until https://github.com/inversify/InversifyJS/issues/1035).
                return false
            case ComputedTextBoundsAction.KIND:
                return true
            case PerformActionAction.KIND:
                return true
            case RequestTextBoundsCommand.KIND:
                return false
            case SetSynthesisAction.KIND:
                return true
            case RequestDiagramPieceAction.KIND:
                return true;
        }
        return super.handleLocally(action)
    }

    handle(action: Action): void | ICommand | Action {
        this.logger.log(this, "handle(action): " + action.kind)
        if (action.kind === SetSynthesesAction.KIND) {
            this.handleSetSyntheses(action as SetSynthesesAction)
        } else if (action.kind === PerformActionAction.KIND &&
            (action as PerformActionAction).actionId === 'de.cau.cs.kieler.kicool.ui.klighd.internal.model.action.OpenCodeInEditorAction') {
            onDisplayInputModelEmitter.fire(action)
        } else if (action.kind === PerformActionAction.KIND &&
            (action as PerformActionAction).actionId === 'de.cau.cs.kieler.simulation.ui.synthesis.action.StartSimulationAction') {
            startSimulationEmitter.fire(action)
        } else if (action.kind === PerformActionAction.KIND &&
            (action as PerformActionAction).actionId === 'de.cau.cs.kieler.simulation.ui.synthesis.action.AddCoSimulationAction') {
            addCoSimulationEmitter.fire(action)
        } else if (action.kind === CheckImagesAction.KIND) {
            this.handleCheckImages(action as CheckImagesAction)
        } else if (action.kind === StoreImagesAction.KIND) {
            this.handleStoreImages(action as StoreImagesAction)
        } else if (action.kind === updateOptionsKind) {
            onUpdateOptionsEmitter.fire(action)
        } else if (action.kind === RequestKeithPopupModelAction.KIND && action instanceof RequestKeithPopupModelAction) {
            this.handleRequestKeithPopupModel(action as RequestKeithPopupModelAction)
        } else if (action.kind === RequestPopupModelAction.KIND
            || action.kind === SwitchEditModeAction.KIND
            || action.kind === BringToFrontAction.KIND) {
            // Ignore these ones
        } else if (action.kind === RequestDiagramPieceAction.KIND) {
            this.handleRequestDiagramPiece(action as RequestDiagramPieceAction)
        } else {
            super.handle(action)
        }
    }

    handleSetSyntheses(action: SetSynthesesAction) {
        this.connector.synthesisRegistry.setAvailableSyntheses(action.syntheses)
        this.connector.synthesisCommandContribution.onNewSyntheses(action.syntheses)
        this.connector.synthesisRegistry.setProvidingDiagramServer(this)
    }

    handleCheckImages(action: CheckImagesAction) {
        // check in local storage, if these images are already stored. If not, send back a request for those images.
        const notCached: Pair<string, string>[] = []
        for (let image of (action as CheckImagesAction).images) {
            const id = KeithDiagramServer.imageToSessionStorageString(image.bundleName, image.imagePath)
            if (isNullOrUndefined(sessionStorage.getItem(id))) {
                notCached.push({k: image.bundleName, v: image.imagePath})
            }
        }
        this.actionDispatcher.dispatch(new CheckedImagesAction(notCached))
    }

    handleStoreImages(action: StoreImagesAction) {
        // Put the new images in session storage.
        for (let imagePair of (action as StoreImagesAction).images) {
            const imageIdentifier = imagePair.k
            const id = KeithDiagramServer.imageToSessionStorageString(imageIdentifier.k, imageIdentifier.v)
            const imageString = imagePair.v
            sessionStorage.setItem(id, imageString)
        }
    }

    /**
     * Converts the representation of the image data into a single string for identification in sessionStorage.
     *
     * @param bundleName The bundle name of the image.
     * @param imagePath The image path of the image.
     */
    static imageToSessionStorageString(bundleName: string, imagePath: string) {
        return bundleName + ":" + imagePath
    }

    handleRequestKeithPopupModel(action: RequestKeithPopupModelAction) {
        const element = findElement(this.currentRoot, action.elementId)
        if (element) {
            this.rootPopupModelProvider.getPopupModel(action, element).then(model => {
                if (model) {
                    this.actionDispatcher.dispatch(new SetPopupModelAction(model))
                }
            })
        }
        return false
    }

    handleRequestDiagramPiece(action: RequestDiagramPieceAction) {
        this.forwardToServer(action)
    }

    disconnect() {
        super.disconnect()
        // Unregister all commands for this server on disconnect.
        this.connector.synthesisRegistry.clearAvailableSyntheses()
        this.connector.synthesisCommandContribution.onNewSyntheses([])
    }

    initialize(registry: ActionHandlerRegistry): void {
        super.initialize(registry)

        // Register the KEITH specific new actions.
        registry.register(BringToFrontAction.KIND, this)
        registry.register(CheckImagesAction.KIND, this)
        registry.register(CheckedImagesAction.KIND, this)
        registry.register(ComputedTextBoundsAction.KIND, this)
        registry.register(DeleteLayerConstraintAction.KIND, this)
        registry.register(DeletePositionConstraintAction.KIND, this)
        registry.register(DeleteStaticConstraintAction.KIND, this)
        // registry.register(KeithUpdateModelAction.KIND, this)
        registry.register(PerformActionAction.KIND, this)
        registry.register(RectPackSetPositionConstraintAction.KIND, this)
        registry.register(RectPackDeletePositionConstraintAction.KIND, this)
        registry.register(RefreshDiagramAction.KIND, this)
        registry.register(RefreshLayoutAction.KIND, this)
        registry.register(RequestKeithPopupModelAction.KIND, this)
        registry.register(RequestTextBoundsCommand.KIND, this)
        registry.register(SetAspectRatioAction.KIND, this)
        registry.register(SetLayerConstraintAction.KIND, this)
        registry.register(SetPositionConstraintAction.KIND, this)
        registry.register(SetStaticConstraintAction.KIND, this)
        registry.register(SetSynthesesAction.KIND, this)
        registry.register(SetSynthesisAction.KIND, this)
        registry.register(StoreImagesAction.KIND, this)
        registry.register(SwitchEditModeAction.KIND, this)
        registry.register(updateOptionsKind, this)
        registry.register(RequestDiagramPieceAction.KIND, this)
        registry.register(SetDiagramPieceAction.KIND, this)
    }

    handleComputedBounds(_action: ComputedBoundsAction): boolean {
        // ComputedBounds actions should not be generated and forwarded anymore, since only the computedTextBounds action is used by kgraph diagrams
        if (this.viewerOptions.needsServerLayout) {
            return true;
        } else {
            return false
        }
    }

    get connector(): KeithTheiaSprottyConnector {
        return this._connector as KeithTheiaSprottyConnector;
    }

    getWidget(): KeithDiagramWidget {
        return this.connector.widgetManager.getWidgets(this.connector.diagramManager.id).pop() as KeithDiagramWidget
    }
}