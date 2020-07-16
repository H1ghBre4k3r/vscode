/*
 * KIELER - Kiel Integrated Environment for Layout Eclipse RichClient
 *
 * http://rtsys.informatik.uni-kiel.de/kieler
 *
 * Copyright 2018, 2020 by
 * + Kiel University
 *   + Department of Computer Science
 *     + Real-Time and Embedded Systems Group
 *
 * This code is provided under the terms of the Eclipse Public License (EPL).
 */

import { KeithDiagramManager } from '@kieler/keith-diagram/lib/browser/keith-diagram-manager';
import { displayInputModel } from '@kieler/keith-diagram/lib/browser/keith-diagram-server'
import { KeithDiagramWidget } from '@kieler/keith-diagram/lib/browser/keith-diagram-widget';
import { KeithLanguageClientContribution } from '@kieler/keith-language/lib/browser/keith-language-client-contribution';
import { PerformActionAction } from '@kieler/keith-sprotty/lib/actions/actions';
import {
    AbstractViewContribution, DidCreateWidgetEvent, FrontendApplication, FrontendApplicationContribution, KeybindingRegistry, open, OpenerService, PrefixQuickOpenService,
    StatusBar, StatusBarAlignment, Widget, WidgetManager
} from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { Command, CommandHandler, CommandRegistry, Emitter, Event, MessageService } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { FileStat, FileSystem, FileSystemUtils } from '@theia/filesystem/lib/common';
import { FileChange, FileSystemWatcher } from '@theia/filesystem/lib/browser';
import { NotificationType, Workspace } from '@theia/languages/lib/browser';
import { OutputChannelManager } from '@theia/output/lib/common/output-channel';
import { UserStorageUri } from '@theia/userstorage/lib/browser';
import { inject, injectable } from 'inversify';
import {
    CANCEL_COMPILATION, COMPILE, compilerWidgetId, EDITOR_UNDEFINED_MESSAGE, GET_SYSTEMS, OPEN_COMPILER_WIDGET_KEYBINDING,
    SHOW, SHOW_NEXT_KEYBINDING, SHOW_PREVIOUS_KEYBINDING
} from "../common";
import {
    REQUEST_CS, REVEAL_COMPILATION_WIDGET, SELECT_COMPILATION_CHAIN, SELECT_SNAPSHOT_COMPILATION_CHAIN, SHOW_NEXT, SHOW_PREVIOUS, TOGGLE_AUTO_COMPILE,
    TOGGLE_BUTTON_MODE, TOGGLE_INPLACE, TOGGLE_PRIVATE_SYSTEMS, TOGGLE_SHOW_RESULTING_MODEL
} from '../common/commands';
import { delay } from "../common/helper";
import { Code, CodeContainer, CompilationSystem } from "../common/kicool-models";
import { CompilerWidget, ShowSnapshotEvent } from "./compiler-widget";
import { KiCoolKeybindingContext } from "./kicool-keybinding-context";

export const snapshotDescriptionMessageType = new NotificationType<CodeContainer, void>('keith/kicool/compile');
export const cancelCompilationMessageType = new NotificationType<boolean, void>('keith/kicool/cancel-compilation');
export const compilationSystemsMessageType = new NotificationType<CompilationSystem[], void>('keith/kicool/compilation-systems');

export const compilationStatusPriority: number = 5
export const requestSystemStatusPriority: number = 6

/**
 * Contribution for CompilerWidget to add functionality to it and link with the current editor.
 */
@injectable()
export class KiCoolContribution extends AbstractViewContribution<CompilerWidget> implements FrontendApplicationContribution, TabBarToolbarContribution {

    isCompiled: Map<string, boolean> = new Map
    sourceURI: Map<string, string> = new Map
    resultMap: Map<string, CodeContainer> = new Map
    indexMap: Map<string, number> = new Map
    lengthMap: Map<string, number> = new Map

    editor: EditorWidget
    compilerWidget: CompilerWidget

    startTime: number
    endTime: number

    /**
     * Holds all commands, updates after new compilation systems are requested.
     */
    kicoolCommands: Command[] = []

    public readonly compilationStartedEmitter = new Emitter<KiCoolContribution | undefined>()
    /**
     * Finish of compilation is recognized by cancel of compilation or by receiving a snapshot that is the last of the compilation system.
     * Returns whether compilation has successfully finished (the last snapshot was send).
     */
    public readonly compilationFinishedEmitter = new Emitter<boolean | undefined>()
    public readonly showedNewSnapshotEmitter = new Emitter<string | undefined>()
    public readonly newSimulationCommandsEmitter = new Emitter<CompilationSystem[]>()

    public readonly compilationStarted: Event<KiCoolContribution | undefined> = this.compilationStartedEmitter.event
    /**
     * Finish of compilation is recognized by cancel of compilation or by receiving a snapshot that is the last of the compilation system.
     * Returns whether compilation has successfully finished (the last snapshot was send).
     */
    public readonly compilationFinished: Event<boolean | undefined> = this.compilationFinishedEmitter.event
    public readonly showedNewSnapshot: Event<string | undefined> = this.showedNewSnapshotEmitter.event
    public readonly newSimulationCommands: Event<CompilationSystem[]> = this.newSimulationCommandsEmitter.event

    @inject(Workspace) protected readonly workspace: Workspace
    @inject(MessageService) protected readonly messageService: MessageService
    @inject(FileSystem) public readonly fileSystem: FileSystem
    @inject(OpenerService) protected readonly openerService: OpenerService;
    @inject(FrontendApplication) public readonly front: FrontendApplication
    @inject(OutputChannelManager) protected readonly outputManager: OutputChannelManager
    @inject(KiCoolKeybindingContext) protected readonly kicoolKeybindingContext: KiCoolKeybindingContext
    @inject(KeithDiagramManager) public readonly diagramManager: KeithDiagramManager
    @inject(CommandRegistry) public commandRegistry: CommandRegistry
    @inject(KeybindingRegistry) protected keybindingRegistry: KeybindingRegistry
    @inject(PrefixQuickOpenService) public readonly quickOpenService: PrefixQuickOpenService
    @inject(StatusBar) protected readonly statusbar: StatusBar

    constructor(
        @inject(EditorManager) public readonly editorManager: EditorManager,
        @inject(FileSystemWatcher) protected readonly fileSystemWatcher: FileSystemWatcher,
        @inject(KeithLanguageClientContribution) public readonly client: KeithLanguageClientContribution, // has to be injected for the view command to work
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager
    ) {
        super({
            widgetId: compilerWidgetId,
            widgetName: 'KIELER Compiler',
            defaultWidgetOptions: {
                area: 'bottom',
                rank: 512
            },
            toggleCommandId: 'compiler-widget:toggle',
            toggleKeybinding: OPEN_COMPILER_WIDGET_KEYBINDING
        });
        this.fileSystemWatcher.onFilesChanged(this.onFilesChanged.bind(this))

        this.editorManager.onCurrentEditorChanged(this.onCurrentEditorChanged.bind(this))
        if (editorManager.currentEditor) {
            // if there is already a current editor, use that to initialize, but this should not be the case.
            this.editor = editorManager.currentEditor
            this.onCurrentEditorChanged(this.editor)
        }
        this.widgetManager.onDidCreateWidget(this.onDidCreateWidget.bind(this))
        // TODO: when the diagram closes, also update the view to the default one
        const widgetPromise = this.widgetManager.getWidget(CompilerWidget.widgetId)
        widgetPromise.then(widget => {
            this.initializeCompilerWidget(widget)
        })
    }

    /**
     * This opens the widget on startup.
     * @param app The app.
     */
    onDidInitializeLayout(app: FrontendApplication) {
        this.openView()
    }

    onStart(): void {
        this.statusbar.setElement('request-systems', {
            alignment: StatusBarAlignment.LEFT,
            priority: requestSystemStatusPriority,
            text: '$(spinner fa-pulse fa-fw) No editor focused or no compilation widget opened',
            tooltip: 'No editor focused or no compilation widget opened',
            command: 'compiler-widget:toggle'
        })
    }

    private async initializeCompilerWidget(widget: Widget | undefined) {
        if (widget) {
            this.compilerWidget = widget as CompilerWidget
            this.compilerWidget.requestSystemDescriptions(this.requestSystemDescriptions.bind(this))
            this.compilerWidget.onActivateRequest(this.requestSystemDescriptions.bind(this))
            this.compilerWidget.cancelCompilation(this.cancelCompilation.bind(this))
            this.compilerWidget.showSnapshot(((event: ShowSnapshotEvent) => this.show(event.uri, event.index)).bind(this))
            displayInputModel(this.displayInputModel.bind(this))
            const lClient = await this.client.languageClient
            while (!this.client.running) {
                await delay(100)
            }
            if (!this.editorManager.currentEditor) {
                this.editorManager.all.forEach(editor => {
                    if (editor.isVisible) {
                        this.editor = editor
                    }
                })
            }
            if (this.editor) {
                this.compilerWidget.sourceModelPath = this.editor.editor.uri.toString()
                await this.requestSystemDescriptions()
            }
            lClient.onNotification(snapshotDescriptionMessageType, this.handleNewSnapshotDescriptions.bind(this))
            lClient.onNotification(cancelCompilationMessageType, this.cancelCompilation.bind(this))
            lClient.onNotification(compilationSystemsMessageType, this.handleReceiveSystemDescriptions.bind(this))
            this.showedNewSnapshot(this.handleNewShapshotShown.bind(this))
        }
    }

    handleNewShapshotShown(message: string) {
        this.requestSystemDescriptions()
    }

    onDidCreateWidget(e: DidCreateWidgetEvent): void {
        // This does not work, because sometimes you will write in an editor that is currently hidden.
        // if (e.widget instanceof EditorWidget) {
        //     e.widget.activate()
        // }
        if (e.factoryId === compilerWidgetId) {
            this.initializeCompilerWidget(e.widget)
        }
    }

    onFilesChanged(fileChange: FileChange) {
        // TODO receives two event if file is saved
        if (this.compilerWidget && this.compilerWidget.autoCompile) {
            // TODO autocompile does no longer work that way
            // this.compilerWidget.compileSelectedCompilationSystem()
        }
    }

    async onCurrentEditorChanged(editorWidget: EditorWidget | undefined): Promise<void> {
        // Ignore changes to user storage files, as they are have no representation on the server.
        if (!editorWidget || editorWidget.editor.uri.scheme === UserStorageUri.SCHEME) {
            return
        }
        this.editor = editorWidget
        if (!this.compilerWidget || this.compilerWidget.isDisposed) {
            const widgetPromise = this.widgetManager.getWidget(CompilerWidget.widgetId)
            widgetPromise.then(widget => {
                this.initializeCompilerWidget(widget)
            })
        } else {
            await this.requestSystemDescriptions()
        }
    }

    async requestSystemDescriptions() {
        if (this.compilerWidget && this.editor) {
            // when systems are requested request systems status bar entry is updated
            this.statusbar.setElement('request-systems', {
                alignment: StatusBarAlignment.LEFT,
                priority: requestSystemStatusPriority,
                text: '$(spinner fa-pulse fa-fw) Request compilation systems',
                tooltip: 'Requesting compilation systems...'
            })
            this.compilerWidget.requestedSystems = true
            const lClient = await this.client.languageClient
            const uri = this.editor.editor.uri.toString()
            // Check if language client was already initialized and wait till it is
            let initializeResult = lClient.initializeResult
            while (!initializeResult) {
                // language client was not initialized
                await delay(100)
                initializeResult = lClient.initializeResult
            }
            await lClient.sendNotification(GET_SYSTEMS, uri)
        } else {
            this.compilerWidget.systems = []
            this.addCompilationSystemToCommandPalette(this.compilerWidget.systems)
        }
    }

    /**
     * Message of the server to notify the client what compilation systems are available
     * to compile the original model and the currently opened snapshot.
     * @param systems compilation systems for original model
     * @param snapshotSystems compilation systems for currently opened snapshot
     */
    handleReceiveSystemDescriptions(systems: CompilationSystem[], snapshotSystems: CompilationSystem[]) {
        // Remove status bar element after successfully requesting systems
        this.statusbar.removeElement('request-systems')
        // Sort all compilation systems by id
        systems.sort((a, b) => (a.id > b.id) ? 1 : -1)
        this.compilerWidget.systems = systems
        this.addCompilationSystemToCommandPalette(systems.concat(snapshotSystems))
        this.compilerWidget.sourceModelPath = this.editor.editor.uri.toString()
        this.compilerWidget.requestedSystems = false
        this.compilerWidget.lastRequestedUriExtension = this.editor.editor.uri.path.ext
    }

    /**
     * Removes all old compilation systems from command palette and adds new ones.
     * @param systems compilation systems that should get a compile command
     */
    addCompilationSystemToCommandPalette(systems: CompilationSystem[]) {
        // remove existing commands
        this.kicoolCommands.forEach(command => {
            this.commandRegistry.unregisterCommand(command)
        })
        this.kicoolCommands = []
        // add new commands for original model
        systems.forEach(system => {
            const command: Command = {
                id: system.id + (system.snapshotSystem ? '.snapshot' : ''),
                label: `Compile ${system.snapshotSystem ? 'snapshot' : 'model'} with ${system.label}`, category: "Kicool"}
            this.kicoolCommands.push(command)
            const handler: CommandHandler = {
                execute: (inplace, doNotShowResultingModel) => { // on compile these options are undefined
                    this.compile(system.id, this.compilerWidget.compileInplace || !!inplace, !doNotShowResultingModel && this.compilerWidget.showResultingModel
                        , system.snapshotSystem);
                },
                isVisible: () => {
                    return system.isPublic || this.compilerWidget.showPrivateSystems
                }
            }
            this.commandRegistry.registerCommand(command, handler)
        })
        const simulationSystems = systems.filter(system => system.simulation)
        // Register additional simulation commands
        this.newSimulationCommandsEmitter.fire(simulationSystems)
    }

    registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands)
        commands.registerCommand(TOGGLE_AUTO_COMPILE, {
            execute: () => {
                if (this.compilerWidget) {
                    this.compilerWidget.autoCompile = !this.compilerWidget.autoCompile
                    this.compilerWidget.update()
                }
            }
        })
        commands.registerCommand(TOGGLE_PRIVATE_SYSTEMS, {
            execute: () => {
                if (this.compilerWidget) {
                    this.compilerWidget.showPrivateSystems = !this.compilerWidget.showPrivateSystems
                    // Update compile commands accordingly
                    this.addCompilationSystemToCommandPalette(this.compilerWidget.systems)
                    this.compilerWidget.update()
                }
            }
        })
        commands.registerCommand(TOGGLE_INPLACE, {
            execute: () => {
                if (this.compilerWidget) {
                    this.compilerWidget.compileInplace = !this.compilerWidget.compileInplace
                    this.compilerWidget.update()
                }
            }
        })
        commands.registerCommand(TOGGLE_SHOW_RESULTING_MODEL, {
            execute: () => {
                if (this.compilerWidget) {
                    this.compilerWidget.showResultingModel = !this.compilerWidget.showResultingModel
                    this.compilerWidget.update()
                }
            }
        })
        commands.registerCommand(REQUEST_CS, {
            execute: async () => {
                await this.requestSystemDescriptions()
                this.message("Registered compilation systems", "INFO")
            }
        })
        commands.registerCommand(TOGGLE_BUTTON_MODE, {
            execute: async () => {
                this.compilerWidget.showButtons = !this.compilerWidget.showButtons
                this.compilerWidget.update()
            }
        })
        commands.registerCommand(SELECT_COMPILATION_CHAIN, {
            isEnabled: widget => {
                return (widget !== undefined && !!this.editor)
            },
            execute: () => {
                this.quickOpenService.open('>Kicool: Compile model with ')
            },
            isVisible: widget => {
                return this.editor && (widget !== undefined) && (widget instanceof EditorWidget)
            }
        })
        commands.registerCommand(SELECT_SNAPSHOT_COMPILATION_CHAIN, {
            isEnabled: widget => {
                return widget !== undefined && widget instanceof KeithDiagramWidget
            },
            execute: () => {
                this.quickOpenService.open('>Kicool: Compile snapshot with ')
            },
            isVisible: widget => {
                return widget !== undefined && widget instanceof KeithDiagramWidget
            }
        })
        commands.registerCommand(REVEAL_COMPILATION_WIDGET, {
            isVisible: () => false,
            execute: () => {
                this.front.shell.revealWidget(compilerWidgetId)
            }
        })
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: SELECT_COMPILATION_CHAIN.id,
            command: SELECT_COMPILATION_CHAIN.id,
            tooltip: SELECT_COMPILATION_CHAIN.label
        });
        registry.registerItem({
            id: SELECT_SNAPSHOT_COMPILATION_CHAIN.id,
            command: SELECT_SNAPSHOT_COMPILATION_CHAIN.id,
            tooltip: SELECT_SNAPSHOT_COMPILATION_CHAIN.label
        })
    }

    public message(message: string, type: string) {
        switch (type.toLowerCase()) {
            case "error":
                this.messageService.error(message)
                this.outputManager.getChannel('SCTX').appendLine('ERROR: ' + message)
                this.outputManager.selectedChannel = this.outputManager.getChannel('SCTX')
                break;
            case "warn":
                this.messageService.warn(message)
                this.outputManager.getChannel('SCTX').appendLine('WARN: ' + message)
                break;
            case "info":
                this.messageService.info(message)
                this.outputManager.getChannel('SCTX').appendLine('INFO: ' + message)
                break;
            default:
                this.messageService.log(message)
                this.outputManager.getChannel('SCTX').appendLine('LOG: ' + message)
                break;
        }
    }

    /**
     *
     * @param id id of snapshot e.g. Signal
     * @param index index of snapshot
     */
    public async show(uri: string, index: number) {
        const lClient = await this.client.languageClient
        this.indexMap.set(uri, index)
        await lClient.sendRequest(SHOW, [uri, KeithDiagramManager.DIAGRAM_TYPE + '_sprotty', index])
        // original model must not fire this emitter.
        this.showedNewSnapshotEmitter.fire("Success")
    }

    /**
     * Invoke compilation and update status in widget
     * @param command compilation system
     * @param inplace whether inplace compilation is on or off
     * @param showResultingModel whether the resulting model should be shown in the diagram. Simulation does not do this.
     */
    public async compile(command: string, inplace: boolean, showResultingModel: boolean, snapshot: boolean): Promise<void> {
        this.startTime = performance.now()
        this.compilerWidget.compiling = true
        this.compilerWidget.update()
        await this.executeCompile(command, inplace, showResultingModel, snapshot)
        this.compilerWidget.lastInvokedCompilation = command
        this.compilerWidget.lastCompiledUri = this.compilerWidget.sourceModelPath
        this.compilerWidget.update()
    }

    async executeCompile(command: string, inplace: boolean, showResultingModel: boolean, snapshot: boolean): Promise<void> {
        if (!this.editor) {
            this.message(EDITOR_UNDEFINED_MESSAGE, "error")
            return;
        }

        const uri = this.compilerWidget.sourceModelPath

        if (!this.compilerWidget.autoCompile) {
            this.message("Compiling " + uri + " with " + command, "info")
        }
        const lClient = await this.client.languageClient
        lClient.sendNotification(COMPILE, [uri, KeithDiagramManager.DIAGRAM_TYPE + '_sprotty', command, inplace, showResultingModel, snapshot])
        this.compilationStartedEmitter.fire(this)
    }

    /**
     * Handles the visualization of new snapshot descriptions send by the LS.
     */
    handleNewSnapshotDescriptions(snapshotsDescriptions: CodeContainer, uri: string, finished: boolean, currentIndex: number, maxIndex: number) {
        // Show next/previous command and keybinding if not already added
        if (!this.commandRegistry.getCommand(SHOW_NEXT.id)) {
            this.registerShowNext()
            this.registerShowPrevious()
        }
        this.isCompiled.set(uri as string, true)
        this.resultMap.set(uri as string, snapshotsDescriptions)
        this.compilerWidget.snapshots = snapshotsDescriptions
        const length = snapshotsDescriptions.files.reduce((previousSum, snapshots) => {
            return previousSum + snapshots.length
        }, 0)
        this.lengthMap.set(uri as string, length)
        this.indexMap.set(uri as string, length - 1)
        if (finished)  {
            let errorOccurred = false
            this.compilerWidget.compiling = false
            let errorString = '';
            snapshotsDescriptions.files.forEach(array => {
                array.forEach(element => {
                    element.warnings.forEach(warning => {
                        this.outputManager.getChannel("SCTX").appendLine("WARNING: " + warning)
                    })
                    element.errors.forEach(error => {
                        this.outputManager.getChannel("SCTX").appendLine("ERROR: " + error)
                        errorOccurred = true
                        errorString = errorString + '\n' + error
                    })
                })
            });
            this.compilationFinishedEmitter.fire(!errorOccurred)

            this.endTime = performance.now()
            // Set finished bar if the currentIndex of the processor is the maxIndex the compilation was not canceled
            this.statusbar.setElement('compile-status', {
                alignment: StatusBarAlignment.LEFT,
                priority: compilationStatusPriority,
                text: currentIndex === maxIndex && !errorOccurred ?
                    `$(check) (${(this.endTime - this.startTime).toPrecision(3)}ms)` :
                    `$(times) (${(this.endTime - this.startTime).toPrecision(3)}ms)`,
                tooltip: currentIndex === maxIndex ? 'Compilation finished' : 'Compilation stopped',
                command: REVEAL_COMPILATION_WIDGET.id
            })
            if (errorOccurred) {
                this.message('An error occurred during compilation. Check the Compiler Widget for details.' + errorString, 'error')
            }
        } else {
            // Set progress bar for compilation
            let progress: string = '█'.repeat(currentIndex) + '░'.repeat(maxIndex - currentIndex)

            this.statusbar.setElement('compile-status', {
                alignment: StatusBarAlignment.LEFT,
                priority: compilationStatusPriority,
                text: `$(spinner fa-pulse fa-fw) ${progress}`,
                tooltip: 'Compiling...',
                command: REVEAL_COMPILATION_WIDGET.id
            })
        }
        this.compilerWidget.update()
    }

    /**
     * Notifies the LS to cancel the compilation.
     */
    public async requestCancelCompilation(): Promise<void> {
        const lClient = await this.client.languageClient
        this.compilerWidget.cancellingCompilation = true
        lClient.sendNotification(CANCEL_COMPILATION)
        this.compilationFinishedEmitter.fire(false)
        this.compilerWidget.update()
    }

    /**
     * Notification from LS that the compilation was cancelled.
     * @param success wether cancelling the compilation was successful
     */
    public async cancelCompilation(success: boolean) {
        this.compilerWidget.cancellingCompilation = false
        if (success) {
            this.compilerWidget.compiling = false
        }
    }

    /**
     * Sends request to LS to get text to open new code editor with
     */
    async displayInputModel(action: PerformActionAction) {
        const lClient = await this.client.languageClient
        const codeContainer: Code = await lClient.sendRequest('keith/kicool/get-code-of-model', [action.kGraphElementId, 'keith-diagram_sprotty'])
        const uri = new URI(this.workspace.rootUri + '/KIELER_DEV/' + codeContainer.fileName)
        this.fileSystem.delete(uri.toString())
        this.fileSystem.createFolder(this.workspace.rootUri + '/KIELER_DEV')
        this.getDirectory(uri).then(parent => {
            if (parent) {
                const parentUri = new URI(parent.uri);
                const vacantChildUri = FileSystemUtils.generateUniqueResourceURI(parentUri, parent, uri.path.name, uri.path.ext);

                if (vacantChildUri.toString()) {
                    const fileUri = parentUri.resolve(vacantChildUri.displayName);
                    this.fileSystem.createFile(fileUri.toString()).then(() => {
                        open(this.openerService, fileUri, {
                            mode: 'reveal',
                            widgetOptions: {
                                ref: this.editorManager.currentEditor
                            }
                        }).then(() => {
                            this.editorManager.getByUri(fileUri).then(editor => {
                                if (editor) {
                                    editor.editor.replaceText({
                                        source: fileUri.toString(),
                                        replaceOperations: [{range: {
                                            start: { line: 0, character: 0 },
                                            end: {
                                                line: editor.editor.document.lineCount,
                                                character: editor.editor.document.getLineContent(editor.editor.document.lineCount).length
                                            }
                                        }, text: codeContainer.code}]
                                    })
                                    editor.editor.document.save()
                                }
                            })

                        })
                    })
                }
            }
        })
    }

    protected async getDirectory(candidate: URI): Promise<FileStat | undefined> {
        const stat = await this.fileSystem.getFileStat(candidate.toString());
        if (stat && stat.isDirectory) {
            return stat;
        }
        return this.getParent(candidate);
    }

    protected getParent(candidate: URI): Promise<FileStat | undefined> {
        return this.fileSystem.getFileStat(candidate.parent.toString());
    }

    registerShowNext() {
        this.commandRegistry.registerCommand(SHOW_NEXT, {
            execute: () => {
                if (!this.editor) {
                    this.message(EDITOR_UNDEFINED_MESSAGE, "error")
                    return false;
                }
                const uri = this.compilerWidget.sourceModelPath
                if (!this.isCompiled.get(uri)) {
                    this.message(uri + " was not compiled", "error")
                    return false
                }
                const lastIndex = this.indexMap.get(uri)
                if (lastIndex !== 0 && !lastIndex) {
                    this.message("Index is undefined", "error")
                    return false
                }
                const length = this.lengthMap.get(uri)
                if (length !== 0 && !length) {
                    this.message("Length is undefined", "error")
                    return false
                }
                if (lastIndex === length - 1) { // No show necessary, since the last snapshot is already drawn.
                    return
                }
                this.show(uri, Math.min(lastIndex + 1, length - 1))
            }
        })
        this.keybindingRegistry.registerKeybinding({
            command: SHOW_NEXT.id,
            context: this.kicoolKeybindingContext.id,
            keybinding: SHOW_NEXT_KEYBINDING
        })
    }

    registerShowPrevious() {
        this.commandRegistry.registerCommand(SHOW_PREVIOUS, {
            execute: () => {
                if (!this.editor) {
                    this.message(EDITOR_UNDEFINED_MESSAGE, "error")
                    return false;
                }
                const uri = this.compilerWidget.sourceModelPath
                if (!this.isCompiled.get(uri)) {
                    this.message(uri + " was not compiled", "error")
                    return false
                }
                const lastIndex = this.indexMap.get(uri)
                if (lastIndex !== 0 && !lastIndex) {
                    this.message("Index is undefined", "error")
                    return false
                }
                if (lastIndex === -1) { // No show necessary, since the original model is already drawn.
                    return
                }
                // Show for original model is on the lower bound of -1.
                this.show(uri, Math.max(lastIndex - 1, -1))
            }
        })
        this.keybindingRegistry.registerKeybinding({
            command: SHOW_PREVIOUS.id,
            context: this.kicoolKeybindingContext.id,
            keybinding: SHOW_PREVIOUS_KEYBINDING
        })
    }
}