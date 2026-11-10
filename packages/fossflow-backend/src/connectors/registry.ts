import { beszelConnector } from './beszel.js';
import type { Connector, ConnectorInfo } from './connector.js';

/** Every live source FossFLOW can read. A new connector is one entry here. */
const CONNECTORS: readonly Connector[] = [beszelConnector];

export function findConnector(id: string): Connector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

export function connectorInfos(): ConnectorInfo[] {
  return CONNECTORS.map(({ id, name, description, fields }) => ({ id, name, description, fields }));
}
