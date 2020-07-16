/*
 * KIELER - Kiel Integrated Environment for Layout Eclipse RichClient
 *
 * http://rtsys.informatik.uni-kiel.de/kieler
 *
 * Copyright 2019, 2020 by
 * + Kiel University
 *   + Department of Computer Science
 *     + Real-Time and Embedded Systems Group
 *
 * This code is provided under the terms of the Eclipse Public License (EPL).
 */

import { Emitter } from "@theia/core";
import { Message, ReactWidget, StatefulWidget } from "@theia/core/lib/browser";
import { inject, injectable, LazyServiceIdentifer } from "inversify";
import * as React from "react";
import { SimulationData, SimulationDataBlackList, simulationWidgetId } from "../common";
import { SELECT_SIMULATION_CHAIN, SIMULATE } from "../common/commands";
import { isInternal, reverse } from '../common/helper';
import { SimulationContribution } from "./simulation-contribution";


/**
 * Widget to compile and navigate compilation results. Should be linked to editor.
 */
@injectable()
export class SimulationWidget extends ReactWidget implements StatefulWidget {

    protected readonly onRequestSimulationSystemsEmitter = new Emitter<SimulationWidget | undefined>()

    /**
     * Trace for each symbol.
     */
    public simulationData: Map<string, SimulationData> = new Map

    /**
     * Holds the value that is set in the next tick. Holds only the inputs of the simulation
     */
    public valuesForNextStep: Map<string, any> = new Map

    /**
     * Indicates whether an input value should be sent to the server.
     */
    public changedValuesForNextStep: Map<string, any> = new Map

    /**
     * Map which holds wether a event listener is registered for a symbol
     */
    public eventListenerRegistered: Map<string, boolean> = new Map

    /**
     * Whether the input/output column is added to the table.
     * this is part of the state of the widget.
     */
    protected displayInOut = false

    /**
     * Wether next simulation step should be requested after a time specified by simulation delay
     */
    public play = false

    /**
     * Time in milliseconds to wait till next simulation step is requested in play mode.
     */
    public simulationStepDelay: number = 200

    /**
     * All simulation types
     */
    public simulationTypes: string[] = ["Periodic", "Manual", "Dynamic"]

    /**
     * The currently selected simulation type.
     * The value of this attribute is simulation type selected by default.
     */
    public simulationType: string = "Periodic"

    readonly onDidChangeOpenStateEmitter = new Emitter<boolean>()

    /**
     * Set by SimulationContribution after a simulation is started or stopped.
     * If false disables step, stop and play.
     */
    public controlsEnabled: boolean

    /**
     * Indicates whether the input/output column should be displayed.
     */
    protected inputOutputColumnEnabled: boolean

    /**
     * Indicates whether a simulation is currently running.
     */
    public simulationRunning: boolean

    /**
     * Show internal variables of simulation (e.g. guards, ...)
     */
    protected showInternalVariables: boolean

    /**
     * Categories of variables with their respective members.
     */
    public categories: string[] = []

    public simulationStep: number = -1

    public compilingSimulation: boolean = false

    constructor(
        @inject(new LazyServiceIdentifer(() => SimulationContribution)) protected readonly commands: SimulationContribution
    ) {
        super();
        this.id = simulationWidgetId
        this.title.label = 'Simulation'
        this.title.iconClass = 'fa fa-play-circle ';
        this.addClass(simulationWidgetId) // class for index.css
        this.update()
    }

    protected render(): React.ReactNode {
        if (!this.commands.kicoolContribution ||
            !this.commands.kicoolContribution.compilerWidget) {
            return
        } else {
            return <React.Fragment>
                {this.renderSimulationPanel()}
                <div key="table" className="simulation-table">{this.renderSimulationData()}</div>
            </React.Fragment>
        }
    }

    /**
     * Renders the control panel of the simulation widget.
     * The play/pause button is shown whenever a simulation is running.
     * Step, stop, and IO button are only shown if a simulation is running.
     * The simulation type selectbox and simulation speed input box are always shown.
     * The simulation compilation system selectbox and the compile button are only shown if no simulation is running.
     * The restart button is only shown if the last invoked compilation system is a simulation compilation system.
     * The step counter is only shown, if the simulation is running.
     */
    renderSimulationPanel() {
        return <React.Fragment>
        <div className="simulation-panel">
            {this.simulationRunning ? this.renderPlayPauseButton() : ""}
            {this.simulationRunning ? this.renderStepButton() : ""}
            {this.simulationRunning ? this.renderStopButton() : ""}
            {this.simulationRunning ? this.renderIOButton() : ""}
            {this.simulationRunning ? this.renderShowInternalButton() : ""}
            {!this.commands.kicoolContribution.compilerWidget.showButtons ||
                this.commands.kicoolContribution.compilerWidget.compiling ||
                this.simulationRunning || this.compilingSimulation ? "" : this.renderSimulationButton()}
            {!!this.commands.kicoolContribution.compilerWidget.showButtons &&
                this.commands.kicoolContribution.compilerWidget.lastInvokedCompilation.includes("simulation") &&
                !this.simulationRunning && !this.compilingSimulation ? this.renderRestartButton() : ""}
            {this.simulationRunning ? this.renderStepCounter() : ""}
        </div></React.Fragment>
    }

    renderPlayPauseButton(): React.ReactNode {
        return <div title={this.play ? "Pause" : "Play"} key="play-pause-button" className={'preference-button'}
            onClick={event => this.commands.startOrPauseSimulation()}>
            <div className={'icon fa ' + (this.play ? 'fa-pause-circle' : 'fa-play-circle')}/>
        </div>
    }

    renderStepButton(): React.ReactNode {
        return <div title="Step" key="step-button" className={'preference-button'}
            onClick={event => this.commands.executeSimulationStep()}>
            <div className={'icon fa fa-step-forward'}/>
        </div>
    }

    renderStopButton(): React.ReactNode {
        return <div title="Stop" key="stop-button" className={'preference-button'}
            onClick={event => this.commands.stopSimulation()}>
            <div className={'icon fa fa-stop'}/>
        </div>
    }

    renderIOButton(): React.ReactNode {
        return <div title={"IO"}
            key="io-button" className={'preference-button' + (this.inputOutputColumnEnabled ? '' : ' off')}
            onClick={event => this.toggleIODisplayButton()}>
            <div className={'icon fa fa-exchange'}/>
        </div>
    }

    toggleIODisplayButton() {
        this.inputOutputColumnEnabled = !this.inputOutputColumnEnabled
        this.update()
    }

    renderShowInternalButton(): React.ReactNode {
        return <div title={this.showInternalVariables ? "Disable internal variables" : "Show internal variables"}
            key="toggle-internal-button" className={'preference-button' + (this.showInternalVariables ? '' : ' off')}
            onClick={event => this.toggleShowInternal()}>
            <div className={'icon fa fa-cog'}/>
        </div>
    }

    toggleShowInternal() {
        this.showInternalVariables = !this.showInternalVariables
        this.update()
    }

    renderSimulationButton(): React.ReactNode {
        return <div className={'compile-button'} title="Simulate"
            onClick={event => {
                this.commands.commandRegistry.executeCommand(SELECT_SIMULATION_CHAIN.id)
            }}>
            <div className='icon fa fa-play-circle'> </div>
        </div>
    }

    renderRestartButton(): React.ReactNode {
        return <div className={'compile-button'} title="Restart"
            onClick={event => {
                this.commands.commandRegistry.executeCommand(SIMULATE.id)
            }}>
            <div className='icon rotate180 fa fa-reply'> </div>
        </div>
    }

    renderSimulationData(): React.ReactNode {
        let list: React.ReactElement[] = []
        if (this.simulationData.size === 0) {

        } else {
            this.simulationData.forEach((data, key) => {
                const onBlackList = SimulationDataBlackList.includes(key)
                // only add data that if input, output or internal data should be shown
                if (!onBlackList && (this.showInternalVariables || !isInternal(data))) {
                    // nextStep is never undefined
                    let nextStep = this.valuesForNextStep.get(key)
                    let node: React.ReactElement;
                    if (typeof nextStep === "boolean") { // boolean values are rendered as buttons
                        node = <tr key={key} className="simulation-data-row">
                            {this.renderInputOutputColumn(data)}
                            {this.renderLabelColumn(key)}
                            {this.renderLastValueColumn(data)}
                            <td key="input" className="simulation-data-truncate simulation-td">
                                <div>
                                    <input id={"input-box-" + key}
                                        title={JSON.stringify(nextStep)}
                                        value={JSON.stringify(nextStep)}
                                        className={"simulation-data-button"}
                                        type='button'
                                        onClick={() => { this.setBooleanInput("input-box-" + key, key, nextStep as boolean, data) }}
                                        placeholder={""} readOnly={!data.input} size={1}/>
                                </div>
                            </td>
                            {this.renderValueForNextStepColumn(nextStep)}
                            {this.renderHistoryColumn(data, key)}
                        </tr>
                    } else {
                        node = <tr key={key} className="simulation-data-row">
                            {this.renderInputOutputColumn(data)}
                            {this.renderLabelColumn(key)}
                            {this.renderLastValueColumn(data)}
                            <td key="input" className="simulation-data-truncate simulation-td">
                                <div>
                                    <input id={"input-box-content" + key}
                                        className={"simulation-data-inputbox" + (!data.input ? " inactive-input-box" : "")}
                                        type='text'
                                        onClick={() => {
                                            // If the value is not an input. Nothing should happen on clicking the text field
                                            if (!data.input) {
                                                return
                                            }
                                            this.setContentOfInputbox("input-box-content" + key, key, nextStep)
                                        }}
                                        placeholder={""} readOnly={!data.input} size={1}/>
                                </div>
                            </td>
                            {this.renderValueForNextStepColumn(nextStep)}
                            {this.renderHistoryColumn(data, key)}
                        </tr>
                    }
                    list.push(node)
                }
            })
            return <table className={"simulation-data-table"}>
                <thead>
                    <tr key="headings" className="simulation-data-row">
                        {this.renderInputOutputColumnHeader()}
                        <th key="label" className="simulation-data-truncate setwidth" align="left" ><div className="simulation-div">Symbol</div></th>

                        <th key="value" className="simulation-data-truncate setwidth" align="left"><div className="simulation-div">Last</div></th>

                        <th key="input" className="simulation-data-truncate setwidth" align="left"><div>Input</div></th>

                        <th key="next-step" className="simulation-data-truncate setwidth" align="left"><div className="simulation-div">Next</div></th>

                        <th key="history" className="simulation-data-truncate history setwidth-h" align="left"><div className="simulation-div">History</div></th>
                    </tr>
                </thead>
                <tbody>
                    {list}
                </tbody>
            </table>
        }
    }

    renderInputOutputColumn(data: SimulationData): React.ReactNode {
        if (this.inputOutputColumnEnabled) {
            return <td key="input-output" className="simulation-data-truncate simulation-td" align="left">
                    <div>
                        {data.input ? <div className='icon fa fa-sign-in'></div> : ""}
                        {data.output ? <div className='icon fa fa-sign-out'></div> : ""}
                        {data.categories}
                    </div>
                </td>
        } else {
            return
        }
    }

    renderLabelColumn(key: string): React.ReactNode {
        return <th key="label" className="simulation-data-truncate" align="left"><div>{key}</div></th>
    }

    renderLastValueColumn(data: SimulationData) {
        return <td key="value" className="simulation-data-truncate simulation-td">
            {data.data ? JSON.stringify(data.data[data.data.length - 1]) : ""}
        </td>
    }

    renderValueForNextStepColumn(nextStep: any) {
        return <td key="next-step" className="simulation-data-truncate simulation-td"><div>{JSON.stringify(nextStep)}</div></td>
    }

    renderHistoryColumn(data: SimulationData, key: string) {
        return <td key="history" className="simulation-data-truncate history simulation-td">
            <div>
                <input id={"input-box-history" + key}
                        className={"simulation-history-inputbox inactive-input-box"}
                        type='text'
                        value={data.data ? JSON.stringify(reverse(data.data)) : ""}
                        placeholder={""} readOnly size={1}/>
            </div></td>
    }

    renderInputOutputColumnHeader(): React.ReactNode {
        if (this.inputOutputColumnEnabled) {
            return <th key="input-output" className="simulation-data-truncate setwidth" align="left"><div className="simulation-div">I/O</div></th>
        } else {
            return
        }
    }

    renderStepCounter(): React.ReactNode {
        return <div title="Step Counter">
            <div className='step-counter'>{this.simulationStep}</div>
        </div>
    }

    setBooleanInput(id: string, key: string,  value: any, data: any) {
        if (this.valuesForNextStep.has(key)) {
            // if the value is a boolean just toggle it on click
            this.valuesForNextStep.set(key, !value)
            this.changedValuesForNextStep.set(key, !value)
            this.update()
        }
    }


    /**
     * Set in values in the next step. On click the current nextValue is set as value of the inputbox.
     * One can be sure that the LS handles the type checking.
     */
    setContentOfInputbox(id: string, key: string,  currentNextValue: any) {
        const elem = document.getElementById(id) as HTMLInputElement
        // set value that is the current value that will be set next tick as value of inputbox
        // Add event listener for inputbox
        // on enter the current value of the inputbox should be set as value for the next step
        const eventListenerRegistered = this.eventListenerRegistered.get(key)
        if (!eventListenerRegistered) {
            elem.value = JSON.stringify(currentNextValue)
            elem.addEventListener("keyup", (event) => {
                if (event.keyCode === 13) {
                    // prevents enter from doing things it should not do
                    event.preventDefault()
                    // parse value as JSON
                    let parsedValue
                    try {
                        parsedValue = JSON.parse(elem.value);
                    } catch (error) {
                        // return if not parsable
                        const currentNextValue = this.valuesForNextStep.get(key)
                        elem.value = JSON.stringify(currentNextValue)
                        this.commands.message(error.toString(), "ERROR")
                        return
                    }
                    // always assume that the parsed value is valid
                    this.valuesForNextStep.set(key, parsedValue)
                    this.changedValuesForNextStep.set(key, parsedValue)
                    elem.placeholder = JSON.stringify(parsedValue)
                    this.update()
                }
            })
        }
    }

    onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.update()
    }

    onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
    }

    storeState(): SimulationWidget.Data {
        return {
            displayInOut: this.displayInOut,
            simulationType: this.simulationType,
            simulationStepDelay: this.simulationStepDelay
        }
    }

    restoreState(oldState: SimulationWidget.Data): void {
        this.displayInOut = oldState.displayInOut
        this.simulationType = oldState.simulationType
        if (oldState.simulationStepDelay) {
            this.simulationStepDelay = oldState.simulationStepDelay
        } else {
            this.simulationStepDelay = 200
        }
    }

    simulationDataToString(data: any) {
        if (data instanceof Array) {
            let returnValue = "["
            data.forEach((value, index) => {
                let innerString = ""
                if (value instanceof Array) {
                    innerString = this.simulationDataToString(value)
                } else {
                    if (index !== 0) {
                        innerString = ", "
                    }
                    innerString += value.toString()
                }
                returnValue = returnValue + innerString
            })
            return returnValue + "]"
        } else {
            return data.toString()
        }
    }
}
/**
 * Definition of the state of the corresponding {@link SimulationWidget}.
 */
export namespace SimulationWidget {
    export interface Data {
        displayInOut: boolean
        simulationType: string
        simulationStepDelay: number
    }
}