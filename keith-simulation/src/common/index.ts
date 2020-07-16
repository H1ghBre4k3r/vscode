export const simulationWidgetId: string = 'simulation-widget'

export const OPEN_SIMULATION_WIDGET_KEYBINDING = "ctrlcmd+alt+e"

/**
 * Internal data structure to save all data required to display a simulation in the siulation view.
 */
export class SimulationData {
    data: any[]
    input: boolean
    output: boolean
    categories: string[]
}

/**
 * Message send by the LS when a simulation is started.
 */
export class SimulationStartedMessage {
    successful: boolean
    error: string
    dataPool: object
    propertySet: Map<string, string[]>
}

export class Category {
    name: string
    symbols: string[]
}

/**
 * Message is used as a request and response parameter for a simulation step.
 */
export class SimulationStepMessage {
    values: object
}

/**
 * Message send by the LS whenever a simulation is stopped.
 */
export class SimulationStoppedMessage {
    successful: boolean
    message: string
}

export let SimulationDataBlackList: string[]  = ["#interface"]