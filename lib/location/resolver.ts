import type { LocationScope } from "@/types/location";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`LocationResolver.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/** Resolves a location scope (country → city → area, area optional) from free text, GPS, or explicit user confirmation. */
export interface LocationResolver {
  resolveFromText(text: string): Promise<LocationScope>;
  resolveFromCoordinates(latitude: number, longitude: number): Promise<LocationScope>;
}

class NotConnectedLocationResolver implements LocationResolver {
  async resolveFromText(): Promise<LocationScope> {
    throw new NotConnectedError("resolveFromText");
  }

  async resolveFromCoordinates(): Promise<LocationScope> {
    throw new NotConnectedError("resolveFromCoordinates");
  }
}

/** TODO: implement using the existing TrustHub country/city/area convention once a data source is approved. */
export function createLocationResolver(): LocationResolver {
  return new NotConnectedLocationResolver();
}
