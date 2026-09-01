import type http from "node:http";

export type CapabilityBridgeGatewayOptions = {
  listenPort?: number | string;
  upstreamPort?: number | string;
  bodyLimit?: number | string;
};

export function startCapabilityBridgeGateway(
  options?: CapabilityBridgeGatewayOptions
): http.Server;
