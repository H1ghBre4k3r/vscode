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
import { inject, injectable } from 'inversify';
import {
    Action, CommandExecutionContext, CommandResult, ElementAndBounds, generateRequestId, HiddenCommand, RequestAction, ResponseAction, SModelRootSchema, TYPES, Match, UpdateModelAction, SModelElementSchema, ResetCommand, SModelRoot,
} from 'sprotty/lib';
import { KImage } from '../skgraph-models';
import { SetSynthesesActionData } from '../syntheses/synthesis-message-data';
import { insertSModelElementIntoModel } from '../diagram-pieces/smodel-util';

/**
 * Sent from the server to the client to send a list of all available syntheses for the current model.
 */
export class SetSynthesesAction implements Action {
    static readonly KIND: string = 'setSyntheses'
    readonly kind = SetSynthesesAction.KIND

    constructor(public readonly syntheses: SetSynthesesActionData[]) {
    }
}

/**
 * Sent from the server to the client to store images in base64 format needed for rendering on the client.
 *
 * @author nre
 */
export class StoreImagesAction implements Action {
    static readonly KIND: string = 'storeImages'
    readonly kind = StoreImagesAction.KIND

    constructor(public readonly images: Pair<Pair<string, string>, string>[]) {
    }
}

/**
 * A key-value pair matching the interface of org.eclipse.xtext.xbase.lib.Pair
 */
export interface Pair<K, V> {
    k: K
    v: V
}

/**
 * Sent from the server to the client to check if the {@link KImage}s provided in the message are cached or if they need
 * to be sent to the client again.
 */
export class CheckImagesAction implements RequestAction<CheckedImagesAction> {
    static readonly KIND: string = 'checkImages'
    readonly kind = CheckImagesAction.KIND

    constructor(public readonly images: KImage[],
        public readonly requestId: string = '') {
    }
}

/**
 * Sent from the client to the server to inform it whether images need to be sent to the client before accepting the next diagram.
 */
export class CheckedImagesAction implements ResponseAction {
    static readonly KIND: string = 'checkedImages'
    readonly kind = CheckedImagesAction.KIND

    constructor(public readonly notCached: Pair<string, string>[],
        public readonly responseId = '') {
    }
}

/**
 * Sent from the client to the server to request a new diagram with the given synthesis.
 */
export class SetSynthesisAction implements Action {
    static readonly KIND: string = 'setSynthesis'
    readonly kind = SetSynthesisAction.KIND

    constructor(public readonly id: string) {
    }
}

/**
 * Sent from the client to the model source (e.g. a DiagramServer) to transmit the result of text bounds
 * computation as a response to a RequestTextBoundsAction.
 */
export class ComputedTextBoundsAction implements ResponseAction {
    static readonly KIND = 'computedTextBounds'
    readonly kind = ComputedTextBoundsAction.KIND

    constructor(public readonly bounds: ElementAndBounds[],
                public readonly responseId = '') {
    }
}

/**
 * Sent from the model source to the client to request bounds for the given texts. The texts are
 * rendered invisibly so the bounds can derived from the DOM. The response is a ComputedTextBoundsAction.
 */
export class RequestTextBoundsAction implements RequestAction<ComputedTextBoundsAction> {
    static readonly KIND: string = 'requestTextBounds'
    readonly kind = RequestTextBoundsAction.KIND

    constructor(public readonly textDiagram: SModelRootSchema,
                public readonly requestId: string = '') {}

    /** Factory function to dispatch a request with the `IActionDispatcher` */
    static create(newRoot: SModelRootSchema): Action {
        return new RequestTextBoundsAction(newRoot, generateRequestId());
    }
}

/**
 * The command triggered to perform a hidden rendering of the text diagram defined in the constructor's RequestTextBoundsAction.
 */
@injectable()
export class RequestTextBoundsCommand extends HiddenCommand {
    static readonly KIND: string = RequestTextBoundsAction.KIND

    constructor(@inject(TYPES.Action) protected action: RequestTextBoundsAction) {
        super()
    }

    execute(context: CommandExecutionContext): CommandResult {
        return {
            model: context.modelFactory.createRoot(this.action.textDiagram),
            modelChanged: true,
            cause: this.action
        }
    }

    get blockUntil(): (action: Action) => boolean {
        return action => action.kind === ComputedTextBoundsAction.KIND
    }
}

/**
 * Sent from the client to the diagram server to perform a klighd action on the model.
 * Causes the server to update the diagram accordingly to the action.
 */
export class PerformActionAction implements Action {
    static readonly KIND = 'performAction'
    kind = PerformActionAction.KIND

    constructor(public readonly actionId: string, public kGraphElementId: string, protected kRenderingId: string, protected revision?: number) {
    }
}

/**
 * A sprotty action to refresh the layout. Send from client to server.
 */
export class RefreshLayoutAction implements Action {
    static readonly KIND: string = 'refreshLayout'
    readonly kind = RefreshLayoutAction.KIND
    constructor() {}
}

export class KeithUpdateModelAction extends UpdateModelAction {
    static readonly KIND = 'updateModel';

    public readonly newRoot?: SModelRootSchema;
    public readonly matches?: Match[];
    public cause: Action;

    constructor(input: SModelRootSchema | Match[], cause: Action,
                public readonly animate: boolean = true) {
        super(input, animate)
        this.cause = cause
    }
}

/**
 * Sent from client to request a certain piece of the diagram.
 */
export class RequestDiagramPieceAction implements RequestAction<SetDiagramPieceAction> {
    static readonly KIND: string = 'requestDiagramPiece'
    readonly kind = RequestDiagramPieceAction.KIND

    constructor(public readonly requestId: string = '') {}
}

/**
 * Response to {@link RequestDiagramPieceAction}. Contains the requested SModelElement.
 */
export class SetDiagramPieceAction implements ResponseAction {
    static readonly KIND: string = 'setDiagramPiece'
    readonly kind = SetDiagramPieceAction.KIND

    constructor(public readonly responseId: string = '',
                public readonly diagramPiece: SModelElementSchema) {}
}

/**
 * Command to trigger re-rendering of diagram when new pieces arrive.
 */
@injectable()
export class SetDiagramPieceCommand extends ResetCommand {
    static readonly KIND: string = 'setDiagramPiece'

    root: SModelRoot

    constructor(@inject(TYPES.Action) protected action: SetDiagramPieceAction) {
        super()
    }

    execute(context: CommandExecutionContext): CommandResult {
        this.root = context.modelFactory.createRoot(context.root)
        insertSModelElementIntoModel(
            this.root, 
            context.modelFactory.createElement(this.action.diagramPiece))
        return {
            model: this.root,
            modelChanged: true,
            cause: this.action
        }
    }

    undo(context: CommandExecutionContext): SModelRoot {
        return this.root
    }

    redo(context: CommandExecutionContext): SModelRoot {
        return this.root
    }

}