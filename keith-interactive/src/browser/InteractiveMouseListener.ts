import {
    MoveMouseListener, SModelElement, Action, SNode
} from "sprotty";

import { inject, injectable } from 'inversify';
import { LSTheiaDiagramServer, DiagramLanguageClient, DiagramWidget } from "sprotty-theia/lib/"
import { KNode } from "./ConstraintClasses";
import { PositionConstraint, StaticConstraint } from './Constraint-types';
import { filterKNodes, getLayerOfNode, getNodesOfLayer, getPosInLayer, getActualLayer, getActualTargetIndex } from "./ConstraintUtils";

@injectable()
export class InteractiveMouseListener extends MoveMouseListener {
    private diagramClient: DiagramLanguageClient
    private widget: DiagramWidget

    constructor(@inject(LSTheiaDiagramServer) dserver: LSTheiaDiagramServer
    ) {
        super();
        this.diagramClient = dserver.connector.diagramLanguageClient
        this.widget = dserver.connector.diagramManager.all[0]
    }

    mouseDown(target: SModelElement, event: MouseEvent): Action[] {
        if (target instanceof SNode) {
            let targetNode = target as KNode
            if (targetNode.interactiveLayout) {
                // save the coordinates as shadow coordinates
                targetNode.shadowX = targetNode.position.x
                targetNode.shadowY = targetNode.position.y
                targetNode.shadow = true
            }
        }

        return super.mouseDown(target, event);
    }

    mouseUp(target: SModelElement, event: MouseEvent): Action[] {
        if (this.hasDragged && target instanceof SNode) {
            // if a node is moved set properties
            this.setProperty(target);
            (target as KNode).shadow = false

        }

        return super.mouseUp(target, event);
    }

    /**
     * Sets properties of the target accordingly to the position the target is moved to
     * @param target SModelElement that is moved
     */
    private setProperty(target: SModelElement): void {
        let targetNode: KNode = target as KNode
        let nodes = filterKNodes(targetNode.parent.children)
        // calculate layer and position the target has in the graph at the new position
        let layerOfTarget = getLayerOfNode(targetNode, nodes)
        let nodesOfLayer = getNodesOfLayer(layerOfTarget, nodes)
        let positionOfTarget = getPosInLayer(nodesOfLayer, targetNode)
        let newPositionCons = getActualTargetIndex(positionOfTarget, nodesOfLayer.includes(targetNode), nodesOfLayer)

        let newLayerCons = getActualLayer(targetNode, nodes, layerOfTarget)

        let uriStr = this.widget.uri.toString(true)

        let constraintSet = false

        // layer constraint should only be set if the layer index changed
        if (targetNode.layerId !== layerOfTarget) {
            constraintSet = true

            // If layer and positional Constraint should be set - send them both in one StaticConstraint
            let sc: StaticConstraint = new StaticConstraint(uriStr, targetNode.id, layerOfTarget, newLayerCons, positionOfTarget, newPositionCons)
            this.diagramClient.languageClient.then(lClient => {
                lClient.sendNotification("keith/constraints/setStaticConstraint", sc)
            })
        } else {

            // position constraint should only be set if the position of the node changed
            if (targetNode.posId !== positionOfTarget) {
                constraintSet = true
                // set the position Constraint
                let pc: PositionConstraint = new PositionConstraint(uriStr, targetNode.id, positionOfTarget, newPositionCons)
                this.diagramClient.languageClient.then(lClient => {
                    lClient.sendNotification("keith/constraints/setPositionConstraint", pc)
                })
            }
        }
        // If the node was moved without setting a constraint - let it snap back
        if (!constraintSet) {
            /*let dc: DeleteConstraint = new DeleteConstraint(uriStr, targetNode.id)
            this.diagramClient.languageClient.then(lClient => { lClient.sendNotification("keith/constraints/deleteStaticConstraint", dc) })*/
            this.diagramClient.languageClient.then(lClient => { lClient.sendNotification("keith/constraints/refreshLayout", uriStr) })
        }
    }

}