import { SNode } from "sprotty";
import { KNode, Layer } from "./ConstraintClasses"

/**
 * Calculates the layer the node is in.
 * @param node Node which layer should be calculated.
 * @param nodes All nodes in the same hierarchical level as the node which layer should be calculated.
 */
export function getLayerOfNode(node: KNode, nodes: KNode[]): number {
    // TODO: doesn't work properly when the layerCons of some nodes are greater than their layerId
    let layers = getLayers(nodes)
    let curX = node.position.x + node.size.width / 2

    // check for all layers if the node is in the layer
    for (let i = 0; i < layers.length; i++) {
        let layer = layers[i]
        if (curX < layer.rightX) {
            return i
        }
    }

    // if the node is the only one in the last layer it can not be in a new last layer
    let lastLNodes = getNodesOfLayer(layers.length - 1, nodes)
    if (lastLNodes.length === 1 && lastLNodes[0].selected) {
        // node is in last layer
        return layers.length - 1
    }

    // node is in a new last layer
    return layers.length
}

/**
 * Adjusts the layer constraint value for a node in case that the target layer's id was boosted by an user defined constraint.
 * @param node the node that was moved
 * @param nodes all nodes
 * @param layerCandidate the current candidate value for the new layer constraint
 */
export function getActualLayer(node: KNode, nodes: KNode[], layerCandidate: number) {

    // Examine all nodes that have a layer Id left or equal to the layerCandidate and that have a layerCons > their layerId
    let layerConsLeftofCandidate = nodes.filter(n => n.layerId <= layerCandidate && n.layerCons > n.layerId)

    // In case that there are no such nodes return the layerCandidate
    if (layerConsLeftofCandidate.length === 0) {
        return layerCandidate
    }

    // Search the highest layer constraint among those nodes
    // You can't just look to the left layer or the layer left of the next layer since their could have been an arbitrary numbers
    // of shifts
    let nodeWithMaxCons = null
    let maxCons = -1
    for (let n of layerConsLeftofCandidate) {
        if (n.layerCons > maxCons) {
            nodeWithMaxCons = n
            maxCons = n.layerCons
        }
    }

    if (nodeWithMaxCons !== null) {
        let idDiff = layerCandidate - nodeWithMaxCons.layerId
        return maxCons + idDiff
    }

    return layerCandidate
}

/**
 * Adjusts the target index of a node in the case that the node above it has a position constraint > count of nodes in the layer.
 * @param targetIndex the current candidate target index
 * @param alreadyInLayer signals whether the node already was in the layer before it was moved.
 * @param layerNodes all nodes of the target layer
 */
export function getActualTargetIndex(targetIndex: number, alreadyInLayer: boolean, layerNodes: KNode[]) {
    let localTargetIndex = targetIndex
    if (localTargetIndex > 0) {
        // Check whether there is an user defined pos constraint on the upper neighbour that is higher
        // than its position ID
        let upperIndex = localTargetIndex - 1
        let upperNeighbour = layerNodes[upperIndex]
        let posConsOfUpper = upperNeighbour.posCons
        if (posConsOfUpper > upperIndex) {
            if (alreadyInLayer && upperNeighbour.posId === localTargetIndex) {
                localTargetIndex = posConsOfUpper
            } else {
                localTargetIndex = posConsOfUpper + 1
            }
        }
    }
    return localTargetIndex
}

/**
 * Calculates the layers in a graph based on the layer IDs and positions of the nodes.
 * @param nodes All nodes of the graph which layers should be calculated.
 */
export function getLayers(nodes: KNode[]): Layer[] {
    nodes.sort((a, b) => a.layerId - b.layerId)
    let layers = []
    let layer = 0
    let leftX = Number.MAX_VALUE
    let rightX = Number.MIN_VALUE
    let topY = Number.MAX_VALUE
    let botY = Number.MIN_VALUE
    // calculate bounds of the layers
    for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i]
        if (node.layerId !== layer) {
            // node is in the next layer
            layers[layer] = new Layer(leftX, rightX, leftX + (rightX - leftX) / 2)
            leftX = Number.MAX_VALUE
            rightX = Number.MIN_VALUE
            layer++
        }

        // coordinates of the current node
        let curLX = node.shadow ? node.shadowX : node.position.x
        let curRX = curLX + node.size.width
        let curTY = node.shadow ? node.shadowY : node.position.y
        let curBY = curTY + node.size.height

        // update coordinates of the current layer
        leftX = min(curLX, leftX)
        rightX = max(curRX, rightX)
        topY = min(curTY, topY)
        botY = max(curBY, botY)
    }
    // add last layer
    layers[layer] = new Layer(leftX, rightX, leftX + (rightX - leftX) / 2)

    // update left and right bounds of the layers and set y bounds
    for (let i = 0; i < layers.length - 1; i++) {
        // calculate the mid between two layers
        let leftL = layers[i]
        let rightL = layers[i + 1]
        let mid = leftL.rightX + (rightL.leftX - leftL.rightX) / 2

        // set right bound of the first and left bound of the second layer to the calculated mid
        leftL.rightX = mid
        rightL.leftX = mid

        // set y coordinates
        leftL.topY = topY
        leftL.botY = botY
        rightL.topY = topY
        leftL.botY = botY
    }

    // special case: only one layer exists
    if (layers.length === 1) {
        let firstL = layers[0]
        // add padding to x bounds
        firstL.leftX = firstL.leftX - 10
        firstL.rightX = firstL.rightX + 10
        firstL.topY = topY
        firstL.botY = botY
    } else {
        // update left bound of the first layer
        // add padding
        let firstL = layers[0]
        firstL.leftX = firstL.mid - (firstL.rightX - firstL.mid)

        // update bounds of the last layer
        // left bound of the layer is the right bound of the layer left of it
        let lastL = layers[layers.length - 1]
        lastL.leftX = layers[layers.length - 2].rightX
        // distance from mid of the last layer to the right bound should be the same as to the left bound
        let dist = lastL.mid - lastL.leftX
        lastL.rightX = lastL.mid + dist
        // set y coordinates
        lastL.topY = topY
        lastL.botY = botY
    }

    return layers
}

/**
 * Calculates the nodes that are in the given layer based on the layer IDs of the nodes.
 * @param layer The layer which containing nodes should be calculated.
 * @param nodes All nodes the graph contains.
 */
export function getNodesOfLayer(layer: number, nodes: KNode[]): KNode[] {
    let nodesOfLayer: KNode[] = []
    let counter = 0
    for (let node of nodes) {
        if (node.layerId === layer) {
            nodesOfLayer[counter] = node
            counter++
        }
    }
    return nodesOfLayer
}

/**
 * Calculates the position of the target node in relation to the nodes in layerNs based on their y coordinates.
 * @param layerNs Nodes of the layer the target is in.
 * @param target Node which position should be calculated.
 */
export function getPosInLayer(layerNs: KNode[], target: KNode): number {
    // Sort the layer array by y coordinate.
    layerNs.sort((a, b) => a.position.y - b.position.y)
    // Find the position of the target
    if (layerNs.indexOf(target) !== -1) {
        // target is already in the list
        return layerNs.indexOf(target)
    }

    for (let i = 0; i < layerNs.length; i++) {
        if (target.position.y < layerNs[i].position.y) {
            return i
        }
    }
    return layerNs.length
}

/**
 * Filters the KNodes out of graphElements.
 * @param graphElements Elements which should be filtered.
 */
export function filterKNodes(graphElements: any): KNode[] {
    let nodes: KNode[] = []
    let counter = 0
    for (let elem of graphElements) {
        if (elem instanceof SNode) {
            nodes[counter] = elem as KNode
            counter++
        }
    }
    return nodes
}

/**
 * Calculates the maximum of two numbers.
 * @param a First number.
 * @param b Second nummber.
 */
function max(a: number, b: number): number {
    if (a < b) {
        return b
    } else {
        return a
    }
}

/**
 * Calculates the minimum of two numbers.
 * @param a First number.
 * @param b Second nummber.
 */
function min(a: number, b: number): number {
    if (a < b) {
        return a
    } else {
        return b
    }
}


/**
 * Calculates the layer the selected node is in.
 * Returns -1 if no node of the nodes is selected.
 * @param nodes All nodes of one hierarchical level.
 */
export function layerOfSelectedNode(nodes: KNode[]): number {
    for (let node of nodes) {
        if (node.selected) {
            return getLayerOfNode(node, nodes)
        }
    }
    return -1
}


/**
* determines if one fo the children is selected
* @param root node which children should be checked
*/
export function isChildSelected(root: SNode): boolean {
    let nodes = root.children
    if (nodes !== undefined) {
        for (let node of nodes) {
            if (node instanceof SNode && node.selected) {
                return true
            }
        }
    }
    return false
}