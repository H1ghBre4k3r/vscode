/*
 * KIELER - Kiel Integrated Environment for Layout Eclipse RichClient
 *
 * http://rtsys.informatik.uni-kiel.de/kieler
 *
 * Copyright 2018-2019 by
 * + Kiel University
 *   + Department of Computer Science
 *     + Real-Time and Embedded Systems Group
 *
 * This code is provided under the terms of the Eclipse Public License (EPL).
 */

import { KeithDiagramManager } from '@kieler/keith-diagram/lib/keith-diagram-manager';
import { KeithDiagramWidget } from '@kieler/keith-diagram/lib/keith-diagram-widget';
import { RefreshDiagramAction } from '@kieler/keith-interactive/lib/actions';
import { KeithLanguageClientContribution } from '@kieler/keith-language/lib/browser/keith-language-client-contribution';
import { RenderOption, RenderOptions } from '@kieler/keith-sprotty/lib/options';
import { Command, CommandHandler, CommandRegistry } from '@theia/core';
import { DidCreateWidgetEvent, Widget, WidgetManager } from '@theia/core/lib/browser';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import URI from '@theia/core/lib/common/uri';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { inject, injectable } from 'inversify';
import { GET_OPTIONS, PERFORM_ACTION, SET_LAYOUT_OPTIONS, SET_SYNTHESIS_OPTIONS, diagramOptionsWidgetId, SPROTTY_ACTION } from '../common';
import { GetOptionsResult, LayoutOptionValue, SynthesisOption, ValuedSynthesisOption } from '../common/option-models';
import { DiagramOptionsViewWidget } from './diagramoptions-view-widget';

/**
 * The keybinding to toggle the diagram options view widget.
 */
export const OPEN_DIAGRAM_OPTIONS_WIDGET_KEYBINDING = 'ctrlcmd+shift+h'

/**
 * Frontend contribution of the diagram options view.
 */
@injectable()
export class DiagramOptionsViewContribution extends AbstractViewContribution<DiagramOptionsViewWidget> implements FrontendApplicationContribution {
    editorWidget: EditorWidget
    diagramOptionsViewWidget: DiagramOptionsViewWidget

    /**
     * Client side render options.
     */
    private rOptions: RenderOptions

    /**
     * The dynamically registered commands for the current diagram options.
     */
    protected registeredCommands: Command[]

    constructor(
        @inject(EditorManager) protected readonly editorManager: EditorManager,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(KeithLanguageClientContribution) protected readonly client: KeithLanguageClientContribution,
        @inject(KeithDiagramManager) protected readonly diagramManager: KeithDiagramManager,
        @inject(CommandRegistry) protected readonly commandRegistry: CommandRegistry
    ) {
        super({
            widgetId: diagramOptionsWidgetId,
            widgetName: 'Diagram Options',
            defaultWidgetOptions: {
                area: 'right',
                rank: 500
            },
            toggleCommandId: 'diagramOptionsView:toggle',
            toggleKeybinding: OPEN_DIAGRAM_OPTIONS_WIDGET_KEYBINDING
        })

        this.registeredCommands = []

        // Set up event listeners.
        editorManager.onCurrentEditorChanged(this.currentEditorChanged.bind(this))
        if (editorManager.activeEditor) {
            // if there is already an active editor, use that to initialize
            this.editorWidget = editorManager.activeEditor
            this.currentEditorChanged(this.editorWidget)
        }
        widgetManager.onDidCreateWidget(this.onDidCreateWidget.bind(this))

        // Create and initialize a new widget.
        const widgetPromise = this.widgetManager.getWidget(diagramOptionsWidgetId)
        widgetPromise.then(widget => {
            this.initializeDiagramOptionsViewWidget(widget)
        })
    }

    async initializeLayout(app: FrontendApplication): Promise<void> {
        await this.openView()
    }

    /**
     * Initializes the widget.
     * @param widget The diagram options widget to initialize
     */
    private initializeDiagramOptionsViewWidget(widget: Widget | undefined): void {
        if (widget instanceof DiagramOptionsViewWidget) {
            this.diagramOptionsViewWidget = widget as DiagramOptionsViewWidget
            this.diagramOptionsViewWidget.onSendNewSynthesisOption(this.sendNewSynthesisOption.bind(this))
            this.diagramOptionsViewWidget.onSendNewLayoutOption(this.sendNewLayoutOption.bind(this))
            this.diagramOptionsViewWidget.onSendNewAction(this.sendNewAction.bind(this))
            this.diagramOptionsViewWidget.onActivateRequest(this.updateContent.bind(this))
            this.diagramOptionsViewWidget.onGetOptions(this.updateContent.bind(this))
            this.diagramOptionsViewWidget.onSendNewRenderOption(this.sendNewRenderOption.bind(this))
        }
    }

    /**
     * Sends the new synthesis option to the server via the language client. The server then might cause the diagram to update with this new option.
     * @param option The newly configured synthesis option.
     */
    async sendNewSynthesisOption(option: SynthesisOption): Promise<void> {
        this.sendNewRequestMessage(SET_SYNTHESIS_OPTIONS, { synthesisOptions: [option] })
    }

    /**
     * Sends the new layout option to the server via the language client. The server then might cause the diagram to update with this new option.
     * @param optionValue The newly configured layout option.
     */
    async sendNewLayoutOption(optionValue: LayoutOptionValue): Promise<void> {
        this.sendNewRequestMessage(SET_LAYOUT_OPTIONS, { layoutOptions: [optionValue] })
    }

    /**
     * Sends the action id to the language server via the language client. The server then will perform the action matching that id and might cause the diagram to update with this
     * new option.
     * @param actionId The id of the action that should be performed.
     */
    async sendNewAction(actionId: string): Promise<void> {
        this.sendNewRequestMessage(PERFORM_ACTION, { actionId: actionId })
    }

    /**
     * Updates the render option and the diagram.
     * @param option The newly configured render option.
     */
    async sendNewRenderOption(option: RenderOption) {
        this.rOptions.set(option.sourceHash, option.currentValue)
        // Update the diagram to draw according to the changed render option.
        const lClient = await this.client.languageClient
        await lClient.sendNotification(SPROTTY_ACTION, {clientId: 'keith-diagram_sprotty', action: new RefreshDiagramAction()})
    }

    /**
     * Sends any message with any parameter as a request to the language server.
     * @param messageType The message type as a complete string, such as 'module/specificRequest'
     * @param param The parameter to be sent with the message. There is nothing checking if the parameter fits the message type.
     */
    async sendNewRequestMessage(messageType: string, param: any): Promise<void> {
        const lClient = await this.client.languageClient
        await lClient.sendRequest(messageType, { uri: this.editorWidget.editor.uri.toString(), ...param })
    }

    onDidCreateWidget(e: DidCreateWidgetEvent): void {
        if (e.factoryId === this.diagramManager.id) {
            // Bind the onModelUpdated method here to the modelUpdated event of the diagram widget.
            if (e.widget instanceof KeithDiagramWidget) {
                const renderOptions = e.widget.diContainer.get(RenderOptions)
                if (renderOptions) {
                    this.rOptions = renderOptions
                    if (this.diagramOptionsViewWidget) {
                        this.diagramOptionsViewWidget.setRenderOptions(renderOptions.getRenderOptions())
                    }
                }
                e.widget.onModelUpdated(this.onModelUpdated.bind(this))
                e.widget.disposed.connect(() => {
                    this.onDiagramWidgetsClosed()
                })
            }
        } else if (e.factoryId === diagramOptionsWidgetId) {
            // Initialize the widget and update its content when the widget is created.
            this.initializeDiagramOptionsViewWidget(e.widget)
            if (this.rOptions) {
                (e.widget as DiagramOptionsViewWidget).setRenderOptions(this.rOptions.getRenderOptions())
            }
            this.updateContent()
        }
    }

    /**
     * Called whenever a new model is being displayed by the diagram view. Updates the visible options according to the new model.
     * @param uri The URI the model was created from.
     */
    async onModelUpdated(uri: string): Promise<void> {
        // If no editor widget was activated before, try to find an open editor widget matching the given uri
        if (!this.editorWidget) {
            const editorForUri = await this.editorManager.getByUri(new URI(uri))
            if (editorForUri !== undefined) {
                this.editorWidget = editorForUri
            }
        }
        if (this.diagramOptionsViewWidget && !this.diagramOptionsViewWidget.isDisposed) {
            this.updateContent()
        }
    }

    /**
     * Called whenever the diagram widget is closed. Clear the diagram options view.
     */
    onDiagramWidgetsClosed(): void {
        this.diagramOptionsViewWidget.setSynthesisOptions([])
        this.diagramOptionsViewWidget.setRenderOptions([])
        this.diagramOptionsViewWidget.setLayoutOptions([])
        this.diagramOptionsViewWidget.setActions([])
        this.diagramOptionsViewWidget.update()
    }

    /**
     * Called whenever the currently active editor changes.
     * @param eWidget The editor widget that changed.
     */
    currentEditorChanged(eWidget: EditorWidget | undefined): void {
        // Remember the currently active widget.
        if (eWidget) {
            this.editorWidget = eWidget
        }
        // If the view is not initialized yet, do that now.
        if (!this.diagramOptionsViewWidget || this.diagramOptionsViewWidget.isDisposed) {
            const widgetPromise = this.widgetManager.getWidget(diagramOptionsWidgetId)
            widgetPromise.then(widget => {
                this.initializeDiagramOptionsViewWidget(widget)
            })
        }
    }

    /**
     * Updates the content of the diagram options widget. Sends a request to the server to get the options of the currently opened model and display them in the widget.
     */
    async updateContent(): Promise<void> {
        if (this.editorWidget) {
            // Get the options from the server.
            const lClient = await this.client.languageClient
            const param = {
                uri: this.editorWidget.editor.uri.toString()
            }
            const result: GetOptionsResult = await lClient.sendRequest(GET_OPTIONS, param) as GetOptionsResult
            if (!result) {
                return
            }
            const valuedOptions: ValuedSynthesisOption[] = result.valuedSynthesisOptions
            const synthesisOptions: SynthesisOption[] = []

            // Set up the current value of all options.
            if (valuedOptions) {
                valuedOptions.forEach(valuedOption => {
                    const option = valuedOption.synthesisOption
                    if (valuedOption.currentValue === undefined) {
                        option.currentValue = option.initialValue
                    } else {
                        option.currentValue = valuedOption.currentValue
                    }
                    synthesisOptions.push(option)
                })
            }

            // Register commands in the command palette.
            this.registeredCommands.forEach(command => {
                this.commandRegistry.unregisterCommand(command)
            });
            this.registeredCommands = []
            if (result.actions) {
                result.actions.forEach( action => {
                    const command: Command = {id: "Diagram: " + action.actionId, label: "Diagram: " + action.displayedName}
                    this.registeredCommands.push(command)
                    const handler: CommandHandler = {
                        execute: () => {
                            this.sendNewAction(action.actionId);
                        }
                    }
                    this.commandRegistry.registerCommand(command, handler)
                })
            }

            // Update the widget.
            this.diagramOptionsViewWidget.setSynthesisOptions(synthesisOptions)
            this.diagramOptionsViewWidget.setLayoutOptions(result.layoutOptions)
            this.diagramOptionsViewWidget.setActions(result.actions)
            this.diagramOptionsViewWidget.update()
        }
    }
}