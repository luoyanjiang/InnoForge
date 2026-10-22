import type { ExternalAdapter, ExternalAdapterHealth } from '../../../../../packages/adapters/src/external-adapter.js';
import { createDefaultSimulatorRegistry } from '../../../../../adapters/external/simulator/src/simulator-external-adapters.js';

export class ExternalAdapterRegistry {
  constructor(private readonly adapters: ReadonlyMap<string, ExternalAdapter> = createDefaultSimulatorRegistry()) {}

  list(): readonly ExternalAdapter[] {
    return [...this.adapters.values()];
  }

  get(adapterId: string): ExternalAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  async healthAll(): Promise<readonly ExternalAdapterHealth[]> {
    return Promise.all(this.list().map(adapter => adapter.health()));
  }
}
