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

import { isOSX, isWindows } from "@theia/core";
import { BaseLanguageServerContribution, IConnection, LanguageServerContribution } from '@theia/languages/lib/node';
import { ContainerModule, injectable } from 'inversify';
import * as net from 'net';
import { join, resolve } from 'path';
import { createSocketConnection } from 'vscode-ws-jsonrpc/lib/server';
import { LS_ID, LS_NAME } from '../common';


const osExtension = isWindows ? join('kieler', 'kieler.exe') : (isOSX ? join('kieler.app', 'Contents', 'MacOs', 'kieler') : join('kieler', 'kieler'))
const EXECUTABLE_PATH = resolve(join(__dirname, '..', '..', '..', '..', '..', osExtension))

function getPort(): number | undefined {
    let arg = process.argv.filter(arg => arg.startsWith('--LSP_PORT='))[0]
    if (!arg) {
        return undefined
    } else {
        return Number.parseInt(arg.substring('--LSP_PORT='.length), 10)
    }
}

function getLsPath(): string | undefined {
    let arg = process.argv.filter(arg => arg.startsWith('--LS_PATH='))[0]
    if (!arg) {
        return undefined
    } else {
        return arg.substring('--LS_PATH='.length)
    }
}

@injectable()
class KeithLanguageServerContribution extends BaseLanguageServerContribution {

    readonly id = LS_ID
    readonly name = LS_NAME

    async start(clientConnection: IConnection): Promise<void> {
        let socketPort = getPort();
        // check if user specified a port to connect to the LS.
        // If this is the case connect to this port
        if (socketPort) {
            // socket case. Used mostly for debugging.
            console.log("Starting LS over socket.")
            const socket = new net.Socket()
            const serverConnection = createSocketConnection(socket, socket, () => {
                socket.destroy()
            });
            this.forward(clientConnection, serverConnection)
            socket.connect(socketPort)
        } else {
            // stdio case. Used for electron app.
            let lsPath = getLsPath()
            // check whether the path to the LS was specified
            if (!lsPath) {
                // --root-dir is only present in the arguments if KEITH is started in its development setup
                let arg = process.argv.filter(arg => arg.startsWith('--root-dir='))[0]
                if (!arg) {
                    lsPath = EXECUTABLE_PATH
                    console.log("Starting with product path")
                } else {
                    // An exception is thrown if no LS_PATH is specified in the developer setup.
                    throw new Error("No path to LS was specified. Use '--LS_PATH=' to specify one.");
                }
            } else {
                console.log("Starting with LS_PATH as argument")
            }
            console.log("Starting LS with path: " + lsPath)
            const command = lsPath
            const serverConnection = await this.createProcessStreamConnectionAsync(command, []);
            this.forward(clientConnection, serverConnection);
            serverConnection.onClose(() => console.log("Connection closed"))
        }
    }
}

export default new ContainerModule(bind => {
    bind(LanguageServerContribution).to(KeithLanguageServerContribution).inSingletonScope()
})